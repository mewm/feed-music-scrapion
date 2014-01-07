var config = require('./config.js'),
	Hipchatter = require('hipchatter'),
	hipchatter = new Hipchatter(config.hipchatApiKey),
	youtubeDownloader = require('youtube-dl'),
	redis = require("redis"),
	client = redis.createClient(),
	fs = require('fs'),
	ffmpeg = require('fluent-ffmpeg');


var loop = function() {
	console.log('Looping');
	//Get recent messages
	hipchatter.history(config.room, function(err, history){

		var items = history.items;

		//Loop through messages
		items.forEach(function(item) {

			//Test regex for youtube url
			var youtubePattern = /^http:\/\/(?:www\.)?youtube.com\/watch\?(?=[^?]*v=\w+)(?:[^\s?]+)?$/g;
			var match = youtubePattern.exec(item);

			//If we have a match.
			if(match != null) {

				//Check if we already have downloaded it, or else "want"it
				var url = match.input;
				client.get(url, function(err, reply) {

					if(reply == null) {

						//Download flv
						var download = youtubeDownloader.download(
							item,
							'./tmp',
							['--max-quality=20']
						);

						//Start on download
						download.on('download', function(data) {

							console.log('Download started');
							console.log('filename: ' + data.filename);
							console.log('size: ' + data.size);

							//Tell on hipchat, that
							hipchatter.notify(config.room,
								{
									message: 'Started downloading ' + url,
									color: 'green',
									token: 'avQtc9cw3OBq8n7IB2DnkNSy3MBrHOZRShku8Cj1'
								}, function(err){
									//if (err == null) console.log('Successfully notified the room.');
								}
							);
						});

						//On progress
						download.on('progress', function(data) {
							//process.stdout.write(data.eta + ' ' + data.percent + '% at ' + data.speed + '\r');

						});

						//Errors
						download.on('error', function(err) {
							throw err;
						});

						//When done
						download.on('end', function(data) {
							console.log('\nDownload finished!');
							console.log('ID:', data.id);
							console.log('Filename:', data.filename);
							console.log('Size:', data.size);
							console.log('Time Taken:', data.timeTaken);
							console.log('Time Taken in ms:', + data.timeTakenms);
							console.log('Average Speed:', data.averageSpeed);
							console.log('Average Speed in Bytes:', data.averageSpeedBytes);

							client.set(url, 1);

							hipchatter.notify(config.room,
								{
									message: 'Download finished ' + url + ' after ' + data.timeTaken + '. Started converting to mp3',
									color: 'green',
									token: 'avQtc9cw3OBq8n7IB2DnkNSy3MBrHOZRShku8Cj1'
								}, function(err){
									//if (err == null) console.log('Successfully notified the room.');
								}
							);

							var source = './tmp/' + data.filename;
							var destination = './mp3/' + data.filename + '.mp3';

							var proc = new ffmpeg({ source: source , nolog: true, timeout: 60 })
								.withAudioCodec('libmp3lame')
								.toFormat('mp3')
								.saveToFile(destination, function(stdout, stderr) {

									hipchatter.notify(config.room,
										{
											message: 'Finished converting ' + url,
											color: 'green',
											token: 'avQtc9cw3OBq8n7IB2DnkNSy3MBrHOZRShku8Cj1'
										}, function(err){
											//if (err == null) console.log('Successfully notified the room.');
										}
									);

									fs.unlink(source, function(err) {
										console.log("Removed temporary file: " + source);
									});

									console.log('Finished converting')
								});

						});

					}
				});
			}


		});


	});

}

loop();
setInterval(loop, 60000); //Fourth minute