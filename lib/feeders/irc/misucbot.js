var config = require('../../../config.js'),
	irc = require("irc");


var MisucBot = function(server, channel, nick) {

	var self = this,
		settings = {
			channels: [channel]
		}


	self.bot = new irc.Client(server, nick, {
		channels: settings.channels,
		userName: 'misuc',
		realName: 'M1suc',
		port: 6667
	});



	self.bot.on('error', function (message) {
		console.error('ERROR: %s: %s', message.command, message.args.join(' '));
		console.log(message);
	});


	self.bot.on('registered', function (payload) {
		console.log('Connected as ' + payload.args[0] + ' on ' + payload.server);
		console.log('Welcome message: ' + payload.args[1]);


	});



	/*bot.on('registered', function (message) {
	 bot.say('NickServ', "identify " + config.botName + " " + config.identifyPass)
	 });*/



	/**
	 * Notify room
	 * @param message
	 */
	self.notify = function(message) {
		var date = new Date();
		var prefix = '[' + date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate() + ' ' + date.getHours() + ':' + date.getMinutes() + '] ';
		self.bot.say(channel, message);
		console.log(prefix + message);
	}

}

module.exports = MisucBot;