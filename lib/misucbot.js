var config = require('../config.js'),
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


	self.bot.on('registered', function (message) {
		console.log('Registered');
		console.log(message);
	});



	/*bot.on('registered', function (message) {
	 bot.say('NickServ', "identify " + config.botName + " " + config.identifyPass)
	 });*/



	/**
	 * Notify room
	 * @param message
	 */
	self.notify = function(message) {

		self.bot.say(channel, message);
		console.log(message);

	}

	return self;

}

module.exports = MisucBot;