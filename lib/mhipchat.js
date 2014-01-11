var config = require('../config.js'),
	Hipchatter = require('hipchatter');


/**
 * Simple wrapper for hipchatter library
 * @param apiKey
 * @param roomId
 * @param roomNotificationKey
 * @constructor
 */
var Mhipchat = function(apiKey, roomNotificationKey, roomId) {

	var self = this;

	/**
	 * Get hipchatter library
	 * @type {Hipchatter}
	 */
	self.hipchatter = new Hipchatter(apiKey);


	/**
	 * Fetch chat history
	 * @param callback
	 */
	self.getMessages = function(callback) {

		//Loop through history and return message entries
		self.hipchatter.history(roomId, function(err, messages){

			if(err) {
				console.log(err);
				throw err;
			}

			callback(messages.items);

		});
	}


	/**
	 * Notify room
	 * @param message
	 */
	this.notify = function(message) {

		//Send message
		this.hipchatter.notify(roomId,
			{
				message: message,
				color: 'green',
				token: roomNotificationKey
			}, function(err){
				//Error
			}
		);

		console.log(message);
	}
}

module.exports = Mhipchat;