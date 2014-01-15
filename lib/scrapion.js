var config = require('../config.js'),
	redis = require("redis"),
	fs = require('fs'),
	ffmpeg = require('fluent-ffmpeg'),
	ytdl = require('ytdl'),
	scscraper = require('./scrapers/soundcloud/sc-scraper.js'),
	Mhipchat = require('./feeders/hipchat/mhipchat'),
	MisucBot = require('./feeders/irc/misucbot'),
	util = require("util"),
	urlify = require('urlify').create(),
	now = require("performance-now");



/**
 * Scrapion, downloads a video from a feed and outputs in mp3
 * @constructor
 */
var Scrapion = function() {

	console.log('Scrapion startet. Feed source: ' + config.feedSource);


}


/**
 * Match regex patterns
 * @type {{youtube: RegExp, soundcloud: RegExp}}
 */
Scrapion.prototype.matchPatterns = {
	'youtube': /^https?:\/\/(?:www\.)?youtube.com\/watch\?(?=[^?]*v=\w+)(?:[^\s?]+)?$/,
	'soundcloud': /^https?:\/\/(soundcloud.com|snd.sc)\/(.*)$/
};


/**
 * Fetches the key from the matching regex key and the url
 * @param entry
 * @param callback
 */
Scrapion.prototype.getSourceAndUrl = function (entry, callback) {

	//Loop each regex pattern and check for match
	var patterns = this.matchPatterns;

	for(var source in patterns) {

		if(patterns.hasOwnProperty(source)) {

			var regex = patterns[source];
			var match;

			//If we have a match.
			if((match = regex.exec(entry)) !== null) {
				callback(source, match.input.replace('https', 'http'));
				break;
			}
		}
	}
}

Scrapion.prototype.scanAndDownload = function(msg, cb) {

	var self = this;

	//Get source and url from message
	self.getSourceAndUrl(msg, function(source, url) {

		//Check storage if we've downloaded already
		self.storage.get(url, function(err, inCache) {

			if(err) {
				self.feeder.notify('Error: ' + err.mesage + ' - code: #2')
			} else {
				if(inCache != null) {
					self.feeder.notify('Already downloaded ' + url);
				} else {

					//Get downloader
					var sourceDownloader = self.downloadFactory(source);

					//Create readable stream from URL
					var stream = sourceDownloader(url);

					//Gather some info, register start time, and notify feeder
					var metadata = {};
					var startTime;
					var receivedInfo = false;
					stream.on('info', function(meta, format) {

						receivedInfo = true;
						startTime = now();
						self.feeder.notify('Downloading ' + meta.title + ' ('+ self.bytesToPrettyMegabytes(format.size) +' MB) from url: ' + url);
						metadata = {
							'title': meta.title,
							'timestamp': meta.timestamp,
							'token': meta.token,
							'thumbnail_url': meta.thumbnail_url,
							'length_seconds': meta.length_seconds,
							'view_count': meta.view_count,
							'now': new Date(),
							'saved_as': ''
						};
					});

					//Create write stream
					var tmpFilename = urlify(url),
						tmpFilenameRelative = './tmp/' + tmpFilename,
						fileStream = fs.createWriteStream(tmpFilenameRelative);

					//Start pumping data to file
					stream.pipe(fileStream);

					//Show download status
					var size = 0,
						mb;
					stream.on('data', function(chunk) {
						size += chunk.length;
						mb = self.bytesToPrettyMegabytes(size);
						util.print('Downloaded: ' + mb + ' MB\r');
					});

					//When done, note time, notify feed and convert to mp3
					stream.on('end', function() {
						console.log('arhh');
						//If we didn't receive title, then something is wrong

						if(receivedInfo === false) {
							self.feeder.notify('Did not receive info about entry. Something went wrong');
							cb();
						} else {

							var timeTaken = ((now() - startTime) / 1000).toFixed(1),
								cleanFilename = metadata.title.replace(/\s/g, '_').replace(/"/g, "")  + '.mp3',
								cleanFilenameRelative = config.outputFolder + cleanFilename;

							self.feeder.notify('Finished downloading "' + metadata.title + '" - Size: ' + mb + ' MB - Time taken: ' + timeTaken + ' sec | Converting to MP3...');

							//Converting
							self.convertToMp3(tmpFilenameRelative, cleanFilenameRelative, function() {
								self.feeder.notify('Finished converting "' + metadata.title);
							});

							//Store in storage
							metadata.saved_as = cleanFilename;
							self.storage.set(url, JSON.stringify(metadata));

							cb();
						}



					});

					//Handle errors
					fileStream.on('error', function(err) {
						console.log(err);
					});

					stream.on('error', function(err) {
						self.feeder.notify('Error: ' + err.message + ' - code: #1');
					})


				}
			}


		});
	});

}

/**
 * Start the flow
 */
Scrapion.prototype.startYourEngines = function () {

	var self = this;

	self.feeder = self.feedFactory();
	self.storage = redis.createClient();

	self.storage.on("error", function (err) {
		console.log("Storage not cool");
		process.exit(-1);
	});

	if(config.feedSource == 'HipChat') {

		setInterval(function() {

			//Get messages
			self.feeder.getMessages(function(messages) {

				//Loop through messages
				for(message in messages) {

					var msg = messages[message].message;

					self.scanAndDownload(msg, function() {
						//Done
					})


				}
			});
		}, 60000);

	} else if(config.feedSource == 'IRC') {

			self.feeder.bot.on('message', function (from, to, message) {

				if(to !== config.ircChannel) {

				} else {

					var margs = message.split(' ');
					var first = margs[0];
					var second = margs[1];

					switch (first) {
						case '!download':

							self.scanAndDownload(second, function() {
								//Done
							});

							break;
						case '!purge':
							self.storage.del(second, function(err, result) {

								if(err) {
									self.feeder.notify('Error: ' + err.message);
								} else if(result == 0) {
									self.feeder.notify('Could not find in storage: ' + second);
								} else {
									self.feeder.notify('Removed from storage: ' + second);
								}

							});

							break;
					}

			}


		});
	}
}

/**
 * Pretty megabytes
 * @param bytes
 * @returns {string}
 */
Scrapion.prototype.bytesToPrettyMegabytes = function(bytes) {
	return parseFloat(bytes / 1024 / 1024).toFixed(2);
};


/**
 * Converts source to MP3
 * @param source
 * @param destination
 * @param callback
 */
Scrapion.prototype.convertToMp3 = function (source, destination, callback) {
	console.log(destination);
	var converter = new ffmpeg({ source: source , nolog: true, timeout: 60 })
		.withAudioCodec('libmp3lame')
		.toFormat('mp3')
		.saveToFile(destination, function(stdout, stderr) {
			//Delete temporary file
			//fs.unlink(source, function(err) {
				console.log("Removed temporary file: " + source);
			// });
			callback();
		});
}


/**
 * Feed factory
 * @returns {*}
 */
Scrapion.prototype.feedFactory = function () {

	switch(config.feedSource) {
		case 'HipChat':
			return new Mhipchat(config.hipchatApiKey, config.roomNotificationKey, config.roomId);
			break;

		case 'IRC':
			return new MisucBot('irc.SHOUTcast.com', '#misuc', 'MrMisuc');

		default:
			console.log('Could not detect feeder from: '. config.feedSource);
			break;
	}

	process.exit(-1);

}


/**
 * Download factory
 * @param downloadSource
 * @returns {*}
 */
Scrapion.prototype.downloadFactory = function (downloadSource) {

	switch(downloadSource) {
		case 'youtube':
			return ytdl;
			break;
		case 'soundcloud':
			return scscraper;
			break;

		default:
			console.log('Could not detect downloader from: ' + downloadSource);
			break;
	}

	process.exit(-1);

}

module.exports = Scrapion;