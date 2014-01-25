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
	console.log('Scrapion started. Feed source: ' + config.feedSource);
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
				cb(new Error('Error: ' + err.message + ' - code: #2'), null);
			}

			if(inCache != null) {
				self.feeder.notify('Already downloaded ' + url);
			} else {

				//Get downloader
				var sourceDownloader = self.downloadFactory(source);

				//Create readable stream from URL
				var sourceStream = sourceDownloader(url);

				//Temporary file
				var urlifiedName = urlify(url),
					tempDestFile = {
					name: urlifiedName,
					absolute_path: __dirname + '/../tmp/' + urlifiedName
				};

				var	tempDestStream = fs.createWriteStream(tempDestFile.absolute_path);

				//Gather some info, register start time, and notify feeder
				var metadata = {},
					startTime,
					receivedInfo = false;

				//Got info?
				sourceStream.on('info', function(meta, format) {
					receivedInfo = true;
					startTime = now();
					self.feeder.notify('Downloading ' + meta.title + ' ('+ self.bytesToPrettyMegabytes(format.size) +' MB) from url: ' + url);
					metadata = {
						'url': url,
						'title': meta.title,
						'timestamp': meta.timestamp,
						'token': meta.token,
						'thumbnail_url': meta.thumbnail_url,
						'length_seconds': meta.length_seconds,
						'view_count': meta.view_count,
						'now': new Date(),
						'saved_as': '',
						'tmp' : tempDestFile,
						'download_time' : 0,
						'download_size' : 0
					};
				});

				//Start pumping video into our temporary file
				sourceStream.pipe(tempDestStream);

				//Show download status
				var size = 0, mb;
				sourceStream.on('data', function(chunk) {
					size += chunk.length;
					mb = self.bytesToPrettyMegabytes(size);
					util.print('Downloaded: ' + mb + ' MB\r');
				});

				//When done, note time, notify feed and convert to mp3
				sourceStream.on('end', function() {

					//If we didn't receive title, then something is wrong
					if(receivedInfo === false) {
						cb(new Error('Did not receive info about entry. Something went wrong'), null);
					}

					//Success
					var timeTaken = ((now() - startTime) / 1000).toFixed(1);
					metadata.saved_as = metadata.title.replace(/\s/g, '_').replace(/"/g, "");
					metadata.download_time = timeTaken;
					metadata.download_size = mb;

					cb(null, metadata);

				});

				//Handle errors on read stream (video source)
				sourceStream.on('error', function(err) {
					cb(new Error('Error: ' + err.message + ' - code: #1'), null);
				});

				//Handle errors on destination stream
				tempDestStream.on('error', function(err) {
					cb(new Error('Error: ' + err.message + ' - code: #2'), null);
				});
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

			if (to === config.ircChannel) {

				var margs = message.split(' ');
				var first = margs[0];
				var second = margs[1];

				switch (first) {
					//On track wishes, convert to mp3 afterwards
					case '!track':

						self.scanAndDownload(second, function (err, metadata) {

							//Did any shit happen when downloading?
							if (err) {
								self.feeder.notify(err.message);
								return;
							}

							//We're good, temporary file downloaded
							self.feeder.notify('Finished downloading "' + metadata.title + '" - Size: ' + metadata.download_size + ' MB - Time taken: ' + metadata.download_time + ' sec');

							//Convert to mp3
							self.convertToMp3(

								metadata.tmp.absolute_path, //Source
								config.mp3OutputFolder + metadata.saved_as, //Destination
								function (err, resolvedFilename) {

									if (err) {
										self.feeder.notify(err.message);
										return;
									}
									metadata.saved_as = resolvedFilename;
									self.feeder.notify('Finished converting "' + metadata.title);
									self.storage.set(metadata.url, JSON.stringify(metadata));
								}
							);
						});

						break;
					//On video requests, convert to AVI
					case '!video':

						self.scanAndDownload(second, function (err, metadata) {
							//Did any shit happen when downloading?
							if (err) {
								self.feeder.notify(err.message);
								return;
							}

							//We're good, temporary file downloaded
							self.feeder.notify('Finished downloading "' + metadata.title + '" - Size: ' + metadata.download_size + ' MB - Time taken: ' + metadata.download_time + ' sec');

							//Convert to mp4
							self.convertToAvi(

								metadata.tmp.absolute_path, //Source
								config.videoOutputFolder + metadata.saved_as, //Destination
								function (err, resolvedFilename) {

									if (err) {
										self.feeder.notify(err.message);
										return;
									}
									metadata.saved_as = resolvedFilename;
									self.feeder.notify('Finished converting "' + metadata.title);
									self.storage.set(metadata.url, JSON.stringify(metadata));
								}
							);
						});

						break;
					case '!purge':
						self.storage.del(second, function (err, result) {

							if (err) {
								self.feeder.notify('Error: ' + err.message);
							} else if (result == 0) {
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

	var destination = destination + '.mp3',
		converter = new ffmpeg({ source: source , nolog: true, timeout: 60 })
		.withAudioCodec('libmp3lame')
		.toFormat('mp3')
		.onProgress(function(info) {
			console.log('progress ' + info.percent + '%');
		})
		.saveToFile(destination + '.mp3', function(stdout, stderr, err) {

			if(err) {
				console.log(err);
				console.log('test 23');
				callback(err, null)
			}

			//Delete temporary file
			//fs.unlink(source, function(err) {
			//	console.log("Removed temporary file: " + source);
			// });
			callback(null, destination);
		});
}


/**
 * Converts source to MP4
 * @param source
 * @param destination
 * @param callback
 */
Scrapion.prototype.convertToAvi = function (source, destination, callback) {

	var destination = destination + '.avi';

	var converter = new ffmpeg({ source: source , nolog: true, timeout: 60 })
		.withVideoBitrate(1024)
		.withAudioCodec('libmp3lame')
		.withVideoCodec('divx')
		.toFormat('avi')
		.onProgress(function(info) {
			console.log('progress ' + info.percent + '%');
		})
		.saveToFile(destination, function(stdout, stderr, err) {

			if(err) {
				console.log('testgqwg');
				callback(err, null)
			}

			//Delete temporary file
			//fs.unlink(source, function(err) {
			//	console.log("Removed temporary file: " + source);
			// });
			callback(null, destination);
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