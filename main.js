var config = require('./config.js'),
	Hipchatter = require('hipchatter'),
	youtubeDownloader = require('youtube-dl'),
	redis = require("redis"),
	storage = redis.createClient(),
	fs = require('fs'),
	ffmpeg = require('fluent-ffmpeg'),
	EventEmitter = require('events').EventEmitter,
	sleep = require('sleep');



/**
 * Scrapion, downloads a video from a feed and outputs in mp3
 * @param refreshInterval
 * @constructor
 */
var Scrapion = function(refreshInterval) {

	console.log('Started scraping');
	this.refreshIinterval = refreshInterval;

}

Scrapion.prototype.matchPatterns = {
	'youtube': /^http:\/\/(?:www\.)?youtube.com\/watch\?(?=[^?]*v=\w+)(?:[^\s?]+)?$/g,
	'soundclound': /^https?:\/\/(soundcloud.com|snd.sc)\/(.*)$/g
}

Scrapion.prototype.getSourceAndUrl = function (entry, callback) {

	//Loop each regex pattern and check for match
	var patterns = this.matchPatterns;

	for(var source in patterns) {

		if(patterns.hasOwnProperty(source)) {

			var regex = /^https?:\/\/(?:www\.)?youtube.com\/watch\?(?=[^?]*v=\w+)(?:[^\s?]+)?$/g;
			var match = regex.exec(entry);
			//If we have a match.
			if(match != null) {
				callback(source, match.input);
				break;
			}
		}

	}

}


//Start the whole flow
Scrapion.prototype.startYourEngines = function () {

	var self = this;

	self.feeder = this.feedFactory();

	//Get messages
	self.feeder.getMessages(function(messagess) {

		var messages = [
			'https://www.youtube.com/watch?v=7V7zLrlX-T0',
			'https://www.youtube.com/watch?v=vLfAtCbE_Jc'
		];

		//Loop through messages
		for(message in messages) {

			var msg = messages[message];

			//Get source and url from message
			self.getSourceAndUrl(msg, function(source, url) {

				//Check storage if we've downloaded already
				storage.get(url, function(err, inCache) {

					if(err) throw err;

					if(inCache != null) {
						console.log('Already downloaded ' + url);
					} else {

						//Get downloader
						var sourceDownloader = self.downloadFactory(source);

						//Start download
						var download = sourceDownloader.download(url,'./tmp');
						sleep.sleep(1);

						//Listen to start
						download.on('download', function(item) {
							self.feeder.notify('Started downloading ' + item.filename + ' Size: ' + item.size + ' from url: ' + url);
						});

						//Listen to stop, and start converting
						download.on('end', function(item) {
							self.feeder.notify('Download finished ' + item.filename + ' after ' + item.timeTaken + '. Converting to MP3...');

							var filename = item.filename + '.mp3';
							self.convertToMp3(item.filename, filename, function() {
								self.feeder.notify('Finished converting ' + filename);
							});

						});

						//Error
						download.on('error', function(err) {
							console.log(err);
							throw err;
						});

					}
				});



			});

		}

	});
}


//Convert to mp3
Scrapion.prototype.convertToMp3 = function (source, filename, callback) {

	var converter = new ffmpeg({ source: './tmp/' + source , nolog: true, timeout: 60 })
		.withAudioCodec('libmp3lame')
		.toFormat('mp3')
		.saveToFile(config.outputFolder + filename, function(stdout, stderr) {

			//Delete temporary file
			fs.unlink(source, function(err) {
				console.log("Removed temporary file: " + source);
			});

			callback();
		});
}

//Create feed object
Scrapion.prototype.feedFactory = function () {

	switch(config.feedSource) {
		case 'HipChat':
			return new Mhipchat(config.hipchatApiKey, config.roomId);
			break;

		default:
			console.log('Could not detect feeder from: '. config.feedSource);
			break;
	}

	process.exit(-1);

}


//Create downloader
Scrapion.prototype.downloadFactory = function (downloadSource) {

	switch(downloadSource) {
		case 'youtube':
			return youtubeDownloader;
			break;

		default:
			console.log('Could not detect downloader from: ' + downloadSource);
			break;
	}

	process.exit(-1);

}


/**
 * Simple wrapper for hipchatter library
 * @param apiKey
 * @param roomId
 * @constructor
 */
var Mhipchat = function(apiKey, roomId) {

	var self = this;

	//Store privileged hipchatter object
	self.hipchatter = new Hipchatter(apiKey);

	//Get messages
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


	//Notify room
	this.notify = function(message) {

		//Send message
		/*this.hipchatter.notify(config.room,
			{
				message: message,
				color: 'green',
				token: apiKey
			}, function(err){
				//Done
			}
		);*/

		console.log(message);
	}
}


/**
 * Initiate
 * @type {Scrapion}
 */
var scraper = new Scrapion(10);
scraper.startYourEngines();
setInterval(scraper.startYourEngines(), 60000); //Fourth minute