var router = require('express').Router();
var mongoose = require('mongoose');
var Article = mongoose.model('Article');
var Comment = mongoose.model('Comment');
var User = mongoose.model('User');
var auth = require('../auth');

// Preload article objects on routes with ':article'
router.param('article', function(req, res, next, slug) {
  Article.findOne({ slug: slug})
    .populate('author')
    .then(function (article) {
      if (!article) { return res.sendStatus(404); }

      req.article = article;

      return next();
    }).catch(next);
});

router.param('comment', function(req, res, next, id) {
  Comment.findById(id).then(function(comment){
    if(!comment) { return res.sendStatus(404); }

    req.comment = comment;

    return next();
  }).catch(next);
});

router.get('/', auth.optional, function(req, res, next) {
  var query = {};
  var limit = 20;
  var offset = 0;

  if(typeof req.query.limit !== 'undefined'){
    limit = req.query.limit;
  }

  if(typeof req.query.offset !== 'undefined'){
    offset = req.query.offset;
  }

  if( typeof req.query.tag !== 'undefined' ){
    query.tagList = {"$in" : [req.query.tag]};
  }

  // promises use callbacks very liberally
  // it's for when you don't know what a value is
  // but it'll be defined later on for you to use
  // it's for when you don't want your code to be blocking
  // the way the application knows the data is ready is
  // with a callback by the promise
  // it guarantees you get a resolved value you can use or an error that will be informative
  Promise.all([
    // if it's a database query it has to be async
    // query looks like this:
    // { author: jake, favorites: jake }
    req.query.author ? User.findOne({ username: req.query.author }) : null, // returns jake, or null
    req.query.favorited ? User.findOne({ username: req.query.favorited }) : null // returns favorites, or null
  ]).then(function (results) {
    var author = results[0];
    var favoriter = results[1];

    if (author) {
      // query = { author: DEADBEEF }
      query.author = author._id;
    }

    if(favoriter){
      query._id = {$in: favoriter.favorites};
    } else if(req.query.favorited){
      query._id = {$in: []};
    }

    return Promise.all([

      // another db lookup
      Article.find(query)
        .limit(Number(limit))
        .skip(Number(offset))
        .sort({createdAt: 'desc'})
        .populate('author')
        .exec(), // mongoose query thing, another way of doing callbacks, https://stackoverflow.com/questions/31549857/mongoose-what-does-the-exec-function-do
      Article.count(query).exec(),
      // payload is the main body of the req
      // we need the user id to get the articles written by that user
      req.payload ? User.findById(req.payload.id) : null,
    ]).then(function(results){
      var articles = results[0];
      var articlesCount = results[1];
      var user = results[2];

      return res.json({
        articles: articles.map(function(article){
          return article.toJSONFor(user);
        }),
        articlesCount: articlesCount
      });
    });
  }).catch(next); // promises are resolving in chain 
  // as long as you return something from a promise, you can keep chaining `then`s, or you can stop and do something with data
  // ideally if any errors occur above, the catch will get called and do something to handle the error
});

router.get('/feed', auth.required, function(req, res, next) {
  var limit = 20;
  var offset = 0;

  if(typeof req.query.limit !== 'undefined'){
    limit = req.query.limit;
  }

  if(typeof req.query.offset !== 'undefined'){
    offset = req.query.offset;
  }

  User.findById(req.payload.id).then(function(user){
    if (!user) { return res.sendStatus(401); }

    Promise.all([
      Article.find({ author: {$in: user.following}})
        .limit(Number(limit))
        .skip(Number(offset))
        .populate('author')
        .exec(),
      Article.count({ author: {$in: user.following}})
    ]).then(function(results){
      var articles = results[0];
      var articlesCount = results[1];

      return res.json({
        articles: articles.map(function(article){
          return article.toJSONFor(user);
        }),
        articlesCount: articlesCount
      });
    }).catch(next);
  });
});

router.post('/', auth.required, function(req, res, next) {
  User.findById(req.payload.id).then(function(user){
    if (!user) { return res.sendStatus(401); }

    var article = new Article(req.body.article);

    article.author = user;

    return article.save().then(function(){
      console.log(article.author);
      return res.json({article: article.toJSONFor(user)});
    });
  }).catch(next);
});

// return a article
router.get('/:article', auth.optional, function(req, res, next) {
  Promise.all([
    req.payload ? User.findById(req.payload.id) : null,
    req.article.populate('author').execPopulate()
  ]).then(function(results){
    var user = results[0];

    return res.json({article: req.article.toJSONFor(user)});
  }).catch(next);
});

// update article
router.put('/:article', auth.required, function(req, res, next) {
  User.findById(req.payload.id).then(function(user){
    if(req.article.author._id.toString() === req.payload.id.toString()){
      if(typeof req.body.article.title !== 'undefined'){
        req.article.title = req.body.article.title;
      }

      if(typeof req.body.article.description !== 'undefined'){
        req.article.description = req.body.article.description;
      }

      if(typeof req.body.article.body !== 'undefined'){
        req.article.body = req.body.article.body;
      }

      if(typeof req.body.article.tagList !== 'undefined'){
        req.article.tagList = req.body.article.tagList
      }

      req.article.save().then(function(article){
        return res.json({article: article.toJSONFor(user)});
      }).catch(next);
    } else {
      return res.sendStatus(403);
    }
  });
});

// delete article
router.delete('/:article', auth.required, function(req, res, next) {
  User.findById(req.payload.id).then(function(user){
    if (!user) { return res.sendStatus(401); }

    if(req.article.author._id.toString() === req.payload.id.toString()){
      return req.article.remove().then(function(){
        return res.sendStatus(204);
      });
    } else {
      return res.sendStatus(403);
    }
  }).catch(next);
});

// Favorite an article


const postSpan = beeline.startSpan();
postSpan.addField({ req: req });
router.post('/:article/favorite', auth.required, function (req, res, next) {
  // the response object is a parameter and there are functions we can call on it
  // usually see res.json or res.text
  // express's middleware is handling response object under the hood

  var articleId = req.article._id;

  User.findById(req.payload.id).then(function(user){
    if (!user) { return res.sendStatus(401); }

    // def favorite
    //   if user.favorite(article_id) do
    //     if req.article.updateFavoriteCount() do
    //       return res.json
    //     end 
    //   end
    // end 
    return user.favorite(articleId)
      .then(function () {
        return req.article.updateFavoriteCount()
          .then(function (article) {
            return res.json({ article: article.toJSONFor(user) });
          });
      });
  }).catch(next); // next is the next function. if there's an error, do whatever's supposed to come next
  // a callback is a function, it's not a separate thing. it's called that because of when it takes place
  // a promise comes before callbacks
});
postSpan.finishSpan();

// Unfavorite an article
router.delete('/:article/favorite', auth.required, function(req, res, next) {
  var articleId = req.article._id;

  User.findById(req.payload.id).then(function (user){
    if (!user) { return res.sendStatus(401); }

    return user.unfavorite(articleId).then(function(){
      return req.article.updateFavoriteCount().then(function(article){
        return res.json({article: article.toJSONFor(user)});
      });
    });
  }).catch(next);
});

// return an article's comments
router.get('/:article/comments', auth.optional, function(req, res, next){
  Promise.resolve(req.payload ? User.findById(req.payload.id) : null).then(function(user){
    return req.article.populate({
      path: 'comments',
      populate: {
        path: 'author'
      },
      options: {
        sort: {
          createdAt: 'desc'
        }
      }
    }).execPopulate().then(function (article) {
      return res.json({
        comments: req.article.comments.map(function (comment) {
          return comment.toJSONFor(user);
        })
      });
    });
  }).catch(next);
});

// create a new comment
router.post('/:article/comments', auth.required, function(req, res, next) {
  User.findById(req.payload.id).then(function(user){
    if(!user){ return res.sendStatus(401); }

    var comment = new Comment(req.body.comment);
    comment.article = req.article;
    comment.author = user;

    return comment.save().then(function(){
      req.article.comments.push(comment);

      return req.article.save().then(function(article) {
        res.json({comment: comment.toJSONFor(user)});
      });
    });
  }).catch(next);
});

router.delete('/:article/comments/:comment', auth.required, function(req, res, next) {
  if(req.comment.author.toString() === req.payload.id.toString()){
    req.article.comments.remove(req.comment._id);
    req.article.save()
      .then(Comment.find({_id: req.comment._id}).remove().exec())
      .then(function(){
        res.sendStatus(204);
      });
  } else {
    res.sendStatus(403);
  }
});

module.exports = router;
