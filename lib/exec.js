var util = require('util');
var fs = require('fs');
var path = require('path');
var events = require('events');
var os = require('os');
var net = require('net');
var Socket = net.Socket;
var async = require('async');
var Logger = require('raft-logger-redis').Logger;
var debug = require('debug')('exec');

var ContainerError = require('./error').ContainerError;

var Exec = function(options) {
	events.EventEmitter.call(this);
	this.options = options;
	this.container = options.container;
	this.cmd = Array.isArray(options.cmd) ? options.cmd : options.cmd.split(' ');
	this.exec = null;
	this.stream = null;
	this.stdout = null;
	this.stderr = null;
	this.inspect = null;
	this.done = false;
	this.pass = false;
	this.code = null;
	this.setupStd();
};

//
// Inherit from `events.EventEmitter`.
//
util.inherits(Exec, events.EventEmitter);
module.exports = Exec;

Exec.prototype.setupStd = function() {
	var self = this;

	var logs = Logger.createLogger(this.options.logs);

	if (!this.options.log || typeof this.options.log.stdout == 'string') {
		this.stdout = process.stdout;
	} else {
		this.stdout = logs.create(this.options.log.stdout);
		this.stdout.start();
	}
	if (!this.options.log || typeof this.options.log.stderr == 'string') {
		this.stderr = process.stderr;
	} else {
		this.stderr = logs.create(this.options.log.stderr);
		this.stderr.start();
	}

};
Exec.prototype.create = function(cb) {
	var self = this;
	this.container.exec({
		Cmd : this.cmd,
		AttachStdout : true,
		AttachStderr : true
	}, function(err, exec) {
		if (err)
			return cb(err);
		self.exec = exec;
		self.start(function(err) {
			if (err) {
				return cb(err);
			}
			cb(null, exec);
		});
	});
};
Exec.prototype.start = function(cb) {
	var self = this;

	this.exec.start(function(err, stream) {
		if (err)
			return cb(err);
		self.stream = stream;
		self.setTTL();
		self.attach();
		cb(null, stream);
	});
};
Exec.prototype.setTTL = function() {
	return;
	if (this.options.ttl == Infinity) {
		return;
	}
	this.ttl = setTimeout(function() {

	}, this.options.ttl);
};
Exec.prototype.exitCode = function() {
	var self = this;
	this.exec.inspect(function(err, data) {
		if (err) {
			return self.emit('error', error);
		}

		self.inspect = data;
		self.done = true;
		self.code = data.ExitCode;
		self.pass = self.options.code == data.ExitCode;

		self.emit('exit', data);

	});
};
Exec.prototype.attach = function() {
	var self = this;

	this.container.modem.demuxStream(this.stream, this.stdout, this.stderr);

	this.stream.once('end', this.exitCode.bind(this));

	this.stream.once('error', function(error) {
		self.emit('error', error);
	});
};
