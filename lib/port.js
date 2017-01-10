var Docker = require('dockerode');
var util = require('util');
var fs = require('fs');
var net = require('net');
var path = require('path');
var events = require('events');
var os = require('os');
var portfinder = require('portfinder');
var async = require('async');
var Logger = require('raft-logger-redis').Logger;
var colors = require('colors');

var Container = require('./container');

const DEFAULT_MAX_CLIENTS = 1024;

var Port = function(options) {
	events.EventEmitter.call(this);

	this.options = options;

	this.name = options.name;
	this.address = options.address;
	this.environment = options.environment || 'development';
	this.shuttingDown = false;

	this.maxMemory = options.maxMemory;

	this.multiTenant = options.multiTenant;
	this.maxClients = this.multiTenant ? DEFAULT_MAX_CLIENTS : 1;

	this.reservedMemory = 0;
	this.usagedMemory = 0;

	this.cores = os.cpus().length;

	this.coresUsed = [];

	for (var i = 0; i < this.cores; i++) {
		this.coresUsed[i] = 0;
	};

	this.containers = {};
	this.docker = null;

};
//
// Inherit from `events.EventEmitter`.
//
util.inherits(Port, events.EventEmitter);

Port.prototype.run = function() {

	var options = {};

	if (this.options.docker.socket) {
		var socket = this.options.docker.socket || '/var/run/docker.sock';
		var stats = fs.statSync(socket);

		if (!stats.isSocket()) {
			throw new Error("Are you sure the docker is running?");
		}
		options.socketPath = socket;
	} else if (this.options.docker.host && this.options.docker.port) {
		options.host = this.options.docker.host;
		options.port = this.options.docker.port;
	}

	this.docker = new Docker(options);

	this._getEvents();

	this.emit('run');
};

Port.prototype.start = function(options, callback) {
	var self = this;

	var _options = {
		node : options.node,
		logs : options.logs,
		address : this.address,
		logSession : options.logSession,
		metricSession : options.metricSession,
		stats : !!options.stats,
		shortLived : options.shortLived,
		name : options.name,
		index : options.index,
		uid : options.uid,
		source : options.source,
		channel : options.channel,
		process : options.process,
		docker : this.docker,
		auth : options.auth,
		config : {
			"name" : options.uid,
			"Hostname" : options.hostname || options.name + '.' + options.index,
			"User" : options.user || "herokuishuser",

			"Memory" : options.size.memory * Math.pow(1024, 2) || 256 * Math.pow(1024, 2),
			"MemorySwap" : options.size.memory * Math.pow(1024, 2) || 256 * Math.pow(1024, 2),
			"MemoryReservation" : options.size.memoryReservation * Math.pow(1024, 2) || 256 * Math.pow(1024, 2),

			"CpuShares" : options.size.cpuShares || 512,
			"CpusetCpus" : this.addResources(options.size.memory, options.size.cpuset || "0", options.size.cpuShares || 512),

			"IOMaximumBandwidth" : options.size.ioMaximumBandwidth * Math.pow(1024, 2) || 900 * Math.pow(1024, 2),
			"IOMaximumIOps" : options.size.ioMaximumIOps * 1000 || 512 * 1000,
			"OomKillDisable" : options.size.oomKillDisable || false,

			"ReadonlyRootfs" : true,
			"Tty" : false,
			"Image" : options.image,
			"Volumes" : {

			},
			"ExposedPorts" : {

			},
			"HostConfig" : {
				"PortBindings" : {

				}
			},
			"Dns" : ["8.8.8.8"]
		}
	};

	if (options.cmd) {
		_options.config.Cmd = options.cmd;
	}
	if (options.env) {
		_options.config.Env = [];
		Object.keys(options.env).forEach(function(key) {
			_options.config.Env.push(key + '=' + options.env[key]);
		});
		_options.config.Env.push('MEMORY_AVAILABLE=' + (_options.config.Memory / Math.pow(1024, 2)));
		_options.config.Env.push('WEB_MEMORY=' + ((_options.config.Memory / ( typeof _options.config.CpusetCpus == 'number' ? _options.config.CpusetCpus : _options.config.CpusetCpus.split(',').length)) / 1048576));
		_options.config.Env.push('WEB_CONCURRENCY=' + ( typeof _options.config.CpusetCpus == 'number' ? _options.config.CpusetCpus : _options.config.CpusetCpus.split(',').length));
	}
	if (options.volumes) {
		_options.config.Volumes = {};
		_options.config.Binds = [];
		Object.keys(options.volumes).forEach(function(key) {
			_options.config.Volumes[key] = {};
			_options.config.Binds.push(key + ':' + options.volumes[key]);
		});
	}

	options.ports.forEach(function(exposedPort) {
		_options.config.ExposedPorts[exposedPort] = {  };
		_options.config.HostConfig.PortBindings[exposedPort] = [{
			"HostPort" : "0"
		}];
	});
	//console.log(_options)
	return self._start(_options, callback);

};

Port.prototype.addResources = function(memory, cpusetCpus, cpuShares) {
	var self = this;
	this.usagedMemory += memory;

	var cores = cpusetCpus.split(',');
	for (var i = 0; i < cores.length; i++) {
		this.coresUsed[cores[i]] += cpuShares;
	};
	console.log(this.coresUsed, cpusetCpus, cpuShares, this.usagedMemory, this.maxMemory, ((this.usagedMemory / this.maxMemory) * 100).toFixed(2))
	return cpusetCpus;
};

Port.prototype.removeResources = function(memory, cpusetCpus, cpuShares) {
	this.usagedMemory -= memory;
	var cores = cpusetCpus.split(',');
	for (var i = 0; i < cores.length; i++) {
		this.coresUsed[cores[i]] -= cpuShares;
	};
};

Port.prototype.exec = function(id, options, callback) {

	var container = this.containers[id];

	if (!container) {
		return callback(new Error('no container found'));
	}
	if (['STOPPING', 'STOPPED', 'CRASHED', 'DELETED'].indexOf(container.state) !== -1) {
		return callback(new Error('Container is not running'));
	}

	container.exec(options, callback);

};

Port.prototype.destroy = function(callback) {
	var self = this;

	async.parallel(Object.keys(this.containers).map(function(id) {
		return function(cb) {
			self.stop(id, cb);
		};
	}), function(err) {
		callback();
	});
};

Port.prototype.stop = function(id, callback) {
	var self = this;
	var container = this.containers[id];

	if (!container) {
		return callback(new Error('no container found'));
	}

	if (['STOPPING', 'STOPPED', 'CRASHED', 'DELETED'].indexOf(container.state) !== -1) {
		return callback();
	}
	//console.log(container.config)

	container.stop(true, callback);
};

var states = {
	'INITIALIZING' : 'INITIALIZING'.yellow,
	'STARTING' : 'STARTING'.blue,
	'RUNNING' : 'RUNNING'.green,
	'STOPPING' : 'STOPPING'.white,
	'STOPPED' : 'STOPPED'.gray,
	'CRASHED' : 'CRASHED'.red
};

Port.prototype._start = function(options, callback) {
	var self = this;

	var container = new Container(options);

	container.on('error', function(error) {
		self.emit('error', error);
	});
	container.once('wait', function(data) {
		self.emit('wait', container, data);
	});
	container.once('STOPPED', function(data) {
		delete self.containers[container.id];
		self.removeResources(container.config.Memory / Math.pow(1024, 2), container.config.CpusetCpus, container.config.CpuShares);
		self.emit('STOPPED', container);
	});
	container.once('CRASHED', function(data) {
		delete self.containers[container.id];
		self.removeResources(container.config.Memory / Math.pow(1024, 2), container.config.CpusetCpus, container.config.CpuShares);
		self.emit('CRASHED', container);
	});
	container.on('stats', function(stats) {
		self.emit('stats', stats, container);
	});

	container.states.forEach(function(state) {
		container.on(state, function(data) {
			console.log('State changed to: ' + states[state] + '	' + options.config.Hostname);
			if (state !== 'STARTING')
				self.emit('state', state, container);
		});
	});
	process.nextTick(function() {
		container.start(function(err) {
			if (err) {
				return callback(err);
			}
			self.containers[container.id] = container;
			callback(null, container);
		});
	});

	return container;
};

Port.prototype._options = function(options) {
	var _options = {};

	Object.keys(options).forEach(function(key) {
		_options[key] = options[key];
	});
	delete _options.docker;
	return _options;
};

Port.prototype._getEvents = function() {
	var self = this;
	this.docker.getEvents({
		//
	}, function(err, stream) {
		if (err)
			return self.emit('error', err);
		stream.on('data', function(data) {
			var json = JSON.parse(data.toString());
			self.emit('docker ' + json.status, json);
		});
	});
};

module.exports = Port;
