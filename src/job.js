var Batch = require('batch');

var redis = require('./redis');

var f = function(e,r){
  if (e) console.log(e);
};

var Job = module.exports = function(data) {
  this.data = data;
  this.state = 'unsaved';
  this.redis = redis.client();
};

Job.prototype.getID = function(cb) {
  var self = this;

  if (this.id) return cb(this.id);

  this.redis.incr('qp:' + this.queue.name + '.ids', function(err, id) {
    self.id = id;
    cb(id);
  });
};

Job.prototype.save = function(cb) {
  var self = this;

  var r = self.redis.multi();

  self._save(r, function() {
    r.exec(cb);
  });

  return this;
};


Job.prototype._save = function(r, cb) {
  var self = this;

  r.sadd('qp:job:types', self.queue.name);

  self.getID(function() {

    self
      .set('type', self.queue.name, r)
      .set('created_at', Date.now(), r)
      .set('data', self.data, r)
      .setState('inactive', r);

    r.rpush('qp:' + self.queue.name +':jobs', self.id);

    cb();
  });
};


Job.prototype.set = function(key, val, r, cb){
  this[key] = val;

  if (typeof val === 'object') val = JSON.stringify(val || {});

  (r || this.redis).hset('qp:job:' + this.queue.name + '.' + this.id, key, val, cb || f);

  return this;
};

Job.prototype.setState = function(state, r, cb) {
  if (!r) r = this.redis;

  r.srem('qp:' + this.queue.name + '.' + this.state, this.id, f);

  this.state = state;

  this.set('state', state, r);

  r.sadd('qp:' + this.queue.name + '.' + state, this.id, f);

  return this;

};

Job.prototype.getInfo = function(cb) {
  var self = this;

  if (!this.id) return cb(null);

  this.redis.hgetall('qp:job:' + this.queue.name + '.' + this.id, function(e, data) {
    self._processInfo(data);
    cb();
  });

};

Job.prototype._processInfo = function(info) {
  this.data = JSON.parse(info.data);
  this.state = info.state;
  this.type = info.type;
  this.created_at = new Date(info.created_at);

  if (info.completed_at) this.completed_at = new Date(info.completed_at);
  if (info.updated_at) this.updated_at = new Date(info.updated_at);

};

Job.prototype.remove = function(cb) {
  var r = this.redis.multi();

  r.srem('qp:' + this.queue.name + '.' + this.state, this.id);
  r.del('qp:job:' + this.queue.name + '.' + this.id);
};

Job.prototype.done = function(err, msg) {
  var self = this;

  if (err) return this.error(err);

  var r = this.redis.multi();

  this
    .set('completed_at', Date.now(), r)
    .setState('completed', r);

  r.exec(function() {
    self.worker.process();
  });
};
