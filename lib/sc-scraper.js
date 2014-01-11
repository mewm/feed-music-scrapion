var http = require('http'),
	fs = require('fs'),
	StreamSnitch = require('stream-snitch'),
	streamify = require('streamify');

/**
 * Single API for scraping soundcloud
 *
 * @param url
 * @returns {*}
 * @constructor
 */
function SoundcloudScrapion(url) {

	var stream = streamify({
		superCtor: http.ClientResponse,
		readable: true,
		writable: false
	});

	http.get(url, function(res) {

		//Snitch to filter tracks, before parsing results and stream to download method
		var snitch = new StreamSnitch(/bufferTracks\.push\((\{.+?\})\)/g);
		snitch.once('match', function(match) {
			getReadyAndDownload(JSON.parse(match[1]), stream);
		});

		res.pipe(snitch);

	});

	return stream;
}

/**
 * Get ready to download, and do it!
 * @param result
 * @param stream
 */
getReadyAndDownload = function(result, stream) {

	var pattern = /&\w+;|[^\w\s\(\)\-]/g;

	//Meta data
	var artist = result.user.username.replace(pattern, '').trim();
	var title = result.title.replace(pattern, '').trim();

	//Fetch readable stream
	http.get(result.streamUrl, function(res) {
		http.get(res.headers.location, function(res) {

			//Emit track stats
			stream.emit('info', {
					'title': artist + ' - ' + title,
					'timestamp': '',
					'token': '',
					'thumbnail_url': '',
					'length_seconds': '',
					'view_count': '',
					'now': new Date(),
					'saved_as': ''
				},
				{
					size: res.headers['content-length']
				});

			//Merge with our streamify stream
			stream.resolve(res);

		});
	});
}

module.exports = SoundcloudScrapion;