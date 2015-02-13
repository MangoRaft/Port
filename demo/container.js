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
	logSession : 'docker.test',
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
	console.log('container', data);
});
c.on('_start', function(data) {
	console.log('_start', data);
});
c.on('start', function(data) {
	console.log('start', data);

	c.top(function(err, data) {
		console.log('top', data);
		c.inspect(function(err, data) {
			console.log('inspect', data);
		});
	});
});
c.on('attach', function(data) {
	console.log('attach');
});
c.on('stats memory', function(data) {
	console.log('stats memory', data);
});
c.on('stats cpu', function(data) {
	console.log('stats cpu', data);
});
c.on('exit', function(data) {
	console.log('exit', data);
});
c.on('_stop', function(data) {
	console.log('_stop', data);
});
c.on('_clean', function(data) {
	console.log('_clean', data);
});
c.on('death', function(data) {
	console.log('death', data);
});

process.on('SIGINT', function() {

	c.once('stop', function(data) {
		console.log('stop', data);
		process.exit(1);
	});
	c.once('death', function(data) {
		console.log('death', data);
		process.exit(1);
	});
	c.stop(false);
});

c.start(); 