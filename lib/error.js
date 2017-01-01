var errors = {
	'C1' : {
		code : 'C1',
		message : 'STARTERROR',
		description : 'Aplication crashed within 1500ms of starting'
	},
	'C2' : {
		code : 'C2',
		message : 'INFOERROR',
		description : 'Aplication crashed after info call'
	},
	'C3' : {
		code : 'C3',
		message : 'STATSERROR',
		description : 'Aplication crashed after stats call'
	},
	'C4' : {
		code : 'C4',
		message : 'INSPECTERROR',
		description : 'Aplication crashed after inspect call'
	},
	'C5' : {
		code : 'C5',
		message : 'CREATEERROR',
		description : 'An error occurred when creating the container'
	},
	'C6' : {
		code : 'C6',
		message : 'ATTACHERROR',
		description : 'An error occurred when attaching stdout and stderr'
	},
	'C7' : {
		code : 'C7',
		message : 'CLEANERROR',
		description : 'An error occurred when trying to clean old container'
	},
	'C8' : {
		code : 'C8',
		message : 'TOPERROR',
		description : 'An error occurred when calling top'
	},
	'C9' : {
		code : 'C9',
		message : 'STARTERROR',
		description : 'An error occurred when trying to start the container'
	},
	'C10' : {
		code : 'C10',
		message : 'WAITERROR',
		description : 'An error occurred when calling wait'
	},
	'C11' : {
		code : 'C11',
		message : 'PULLERROR',
		description : 'An error occurred when trying to pull image from registry'
	},
	'C12' : {
		code : 'C12',
		message : 'PULLDATAERROR',
		description : 'An error occurred when pulling image from registry'
	},
	'C13' : {
		code : 'C13',
		message : 'STOPERROR',
		description : 'An error occurred when trying to stop the container'
	},
	'C14' : {
		code : 'C14',
		message : 'PORTDETECTERROR',
		description : 'The container has stopped or crashed before port detect on done'
	},
	'C15' : {
		code : 'C15',
		message : 'PORTERROR',
		description : 'App not listing on required port'
	}
};

module.exports.ContainerError = function ContainerError(code, reason) {
	// Error.captureStackTrace(this, this.constructor);
	this.error = 'ContainerError';
	this.msg = errors[code].message;
	this.code = errors[code].code;
	this.desc = errors[code].description;
	if (reason)
		this.reason = reason;
};

//require('util').inherits(module.exports.ContainerError, Error);
module.exports.PortError = function PortError(code) {
	Error.captureStackTrace(this, this.constructor);
	this.name = this.constructor.name;
	this.message = message;
	this.extra = extra;
};

require('util').inherits(module.exports.PortError, Error);
