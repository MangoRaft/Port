var Port = require('../lib/port');

var p = new Port({
	name : 'demo',
	environment : 'demo',
	maxMemory : 2222222,
	multiTenant : true,
	docker : {
		"host" : "127.0.0.1",
		"port" : 5000
	}
});

p.run();

var redis = {
	"logs" : {
		"web" : {
			"port" : 80,
			"host" : "..."
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
	"name" : "docker.test",
	"index" : 1,
	"uid" : "uid",
	"source" : "app",
	"channel" : "redis.1",
	"process" : "web",
	"volumes" : {},
	"env" : {
		"hello" : "world"
	},
	"limits" : {
		"memory" : 128,
		"cpuShares" : 256,
		"cpuset" : "0,1"
	},
	"image" : "redis",
	"ports" : ["6379/tcp"]
};
p.start(redis, function(err, container) {
	if (err)
		throw err
	container.info(function(err, info) {
		if (err)
			throw err
		//console.log('service running', info, p);
	});
});
p.on('error', function(err) {
	console.log(err);
	throw err;
});

process.on('SIGINT', function() {

	p.destroy(function(data) {
		console.log('destroyed', data);
		process.exit(1);
	});
});
