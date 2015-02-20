var Port = require('../lib/port');

var p = new Port({
	name : 'demo',
	environment : 'demo',
	maxMemory : 2222222,
	multiTenant : true,
	docker : {
		socket : '/var/run/docker.sock'
		//host : '192.168.1.139',
		//port : 5001,
	}
});

p.on('run', function(data) {
	console.log('run');
});
p.on('start', function(data) {
	console.log('start', data);
});
p.on('stop', function(data) {
	console.log('stop');
});
p.on('death', function(data) {
	console.log('death');
});
p.on('attach', function(data) {
	console.log('attach');
});
p.on('container error', function(error) {
	console.log('container error', error);
});

p.run();

var redis = {
	"metrics" : {
		"port" : 4001,
		"host" : "127.0.0.1"
	},
	"metricSesion" : "docker.test",
	"logs" : {
		"web" : {
			"port" : 5000,
			"host" : "127.0.0.1"
		},
		"udp" : {
			"port" : 5000,
			"host" : "127.0.0.1"
		},
		"view" : {
			"port" : 5000,
			"host" : "127.0.0.1"
		}
	},
	"logSession" : "docker.test",
	"source" : "app",
	"channel" : "redis.1",
	"name" : "docker.test",
	"index" : 1,
	"env" : {
		"hello" : "world"
	},
	"uid" : "uid",
	"username" : "demo",
	"limits" : {
		"memory" : 128,
		"cpuShares" : 256,
		"cpuset" : "0,1"
	},
	"image" : "redis",
	"exposedPorts" : ["6379/tcp"]
};
var stress = {
	metrics : {
		"port" : 4001,
		"host" : "127.0.0.1"
	},
	metricSesion : 'docker.test.stress',
	logs : {
		"web" : {
			"port" : 5000,
			"host" : "127.0.0.1"
		},
		"udp" : {
			"port" : 5000,
			"host" : "127.0.0.1"
		},
		"view" : {
			"port" : 5000,
			"host" : "127.0.0.1"
		}
	},
	logSession : 'docker.test.stress',
	source : 'app',
	name : 'stress',
	index : 1,
	uid : 'uid.stress',
	username : 'demo.stress',
	limits : {
		memory : 75,
		cpuShares : 128,
		cpuset : "0,1,2,3"
	},
	image : 'progrium/stress',
	cmd : ['--cpu', '2', '--vm', '1', '--vm-bytes', '40M', '-q'],
	exposedPorts : []
};

p.start(redis, function(err, container) {
	p.start(redis, function(err, container) {

		p.start(redis, function(err, container) {

			p.start(redis, function(err, container) {
				p.start(redis, function(err, container) {
					container.info(function(err, info) {
						console.log('service running', info, p);
					});
				});
			});
		});
	});
});

process.on('SIGINT', function() {

	p.once('destroyed', function(data) {
		console.log('destroyed', data);
		process.exit(1);
	});
	p.destroy();
});
