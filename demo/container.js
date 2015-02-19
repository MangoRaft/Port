var Docker = require('dockerode');
var fs = require('fs');

var Container = require('../lib/container');

var socket = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
var stats = fs.statSync(socket);

if (!stats.isSocket()) {
	throw new Error("Are you sure the docker is running?");
}

var docker = new Docker({
	socketPath : socket
});

var c = new Container({
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
	logSession : 'docker.test.redis.1',
	source : 'app',
	channel : 'redis.1',
	name : 'ubuntu',
	index : 1,
	docker : docker,
	config : {
		"Hostname" : "",
		"Domainname" : "",
		"User" : "",
		"Memory" : 0,
		"MemorySwap" : 0,
		"CpuShares" : 512,
		"Cpuset" : "0,1",
		//"AttachStdin" : false,
		//"AttachStdout" : true,
		//"AttachStderr" : true,
		"Tty" : false,
		//"OpenStdin" : false,
		//"StdinOnce" : false,
		"Env" : null,
		//"Cmd" : ["ps", "aux"],
		"Entrypoint" : "",
		"Image" : "redis",
		"Volumes" : {
			//"/tmp" : {}
		},
		"WorkingDir" : "",
		"NetworkDisabled" : false,
		//"MacAddress" : "12:34:56:78:9a:bc",
		"ExposedPorts" : {

		},
		"HostConfig" : {
			"PortBindings" : {
				"6379/tcp" : [{
					"HostPort" : "11022"
				}]
			},
		}
	},
	"SecurityOpts" : [""],
	"Dns" : ["8.8.8.8"]

});

c.on('container', function(data) {
	//console.log('container', data);
});
c.on('_start', function(data) {
	//console.log('_start', data);
});
c.on('RUNNING', function() {
	console.log('container is now running.');

	c.top(function(err, data) {
		console.log('top', data);
	});
	c.inspect(function(err, data) {
		//console.log('inspect', data);
	});
	c.info(function(err, data) {
		console.log('info', data);
	});
});
c.on('attach', function(data) {
	console.log('attach');
});
c.states.forEach(function(state) {
	c.on(state, function(data) {
		console.log('State changed to: ' + state);
	});
});

process.on('SIGINT', function() {
	if (c.state > 3)
		process.exit(1);
	c.once('STOPPED', function(data) {
		//console.log('STOPPED');
		process.exit(1);
	});
	c.once('DELETED', function(data) {
		//console.log('CRASHED', data);
		process.exit(1);
	});
	c.stop(false);
});

c.start();
