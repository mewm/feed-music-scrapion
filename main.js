var config = require('./config.js'),
	Scrapion = require('./lib/scrapion.js');

/**
 * Initiate
 * @type {Scrapion}
 */
var scraper = new Scrapion();
scraper.startYourEngines();

setInterval(function() {
	scraper.startYourEngines()
}, 60000); //1 minute