/*jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

const request   = require('request-promise');
const utils     = require(__dirname + '/lib/utils');
const adapter   = new utils.Adapter('etamon');
const xpath     = require('xpath');
const xmldom    = require('xmldom').DOMParser;
const select = xpath.useNamespaces({"eta": "http://www.eta.co.at/rest/v1"});
const core = require('@iobroker/adapter-core'); // Get common adapter utils

var menu;
var variables;
var mapping;

adapter.on('ready', function () {
	// Timeout for adapter if ETA takes too long to respond (overall process)
	setTimeout( function() {
		adapter.log.error("ETA service monitoring timeout [" + adapter.config.etaTimeout + "]!");
        adapter.stop();
	}, adapter.config.etaTimeout);
	main();
});

function toXML(body, response, resolveWithFullResponse) {
	return new xmldom().parseFromString(body);
}

/**
 * @param {XMLDocument} menu
 */
function readFUBs() {
	mapping = {};
	request.put(adapter.config.etaService+"vars/etamon")
	.then(function (content) {
		adapter.log.info("**** Adding ETA variable: "+content);
	})
	.catch(function (error) {
		adapter.log.info(error);
	})
	.finally(function () {
		//adapter.log.debug("Creating objects from menu: "+menu);
		var fubs = select("/eta:eta/eta:menu/eta:fub", menu);
		adapter.log.debug("Found "+fubs.length+" fubs.");
		createFUBs(fubs, 0);
	});
}

function createFUBs(fubs, counter) {
	if (counter < fubs.length) {
		adapter.log.debug("Processing fub:"+fubs[counter]);
		var fubName = fubs[counter].getAttribute("name");
		var fubID = fubs[counter].getAttribute("uri").substr(1).replace("/", "_");
		adapter.log.silly("*** Creating channel: " + fubName);	
		adapter.extendObject(fubID, {
			type: 'channel',
			common: {
				name: fubName
			},
			native: {}
		});
		adapter.log.debug("*** Created channel: " + fubName);
		
		//createObjects(fubID, fubID, select("eta:fub/eta:fub/eta:object", fubs[counter]), 0, function() {
		createObjects(fubID, fubID, select("./eta:object", fubs[counter]), 0, function() {
			createFUBs(fubs, ++counter);
		});
	} else {
		adapter.log.debug("Storing configuration: " + mapping);
		adapter.extendObject('mapping', {
			type: 'state',
			common: {
				name: 'Uri-Object-Mapping',
				type: 'text',
				role: 'text'
			},
			native: {}
		}, function(err) {
			if(!err) {
				adapter.log.debug("*** Configuration created");
			} else {
				adapter.log.error("*** Configuration not created: "+err);
			}
			adapter.setState(adapter.name + "." + adapter.instance + ".mapping", JSON.stringify(mapping), true);
			request.get(adapter.config.etaService+"vars/etamon")
			.then(function (data) {
				readData(toXML(data));
			});
		});		
	}
}

/**
 * @param {string} parent
 * @param {Node[]} nodes
 */
function createObjects(fubID, parent, nodes, counter, callback) {
	if (counter < nodes.length) {
		var node = nodes[counter];
		adapter.log.silly("Creating Object for: " + node);
		var objectURI = node.getAttribute("uri");
		var tmpID = objectURI.substr(1).split("/").join("_");
		var objectID = parent + "." + tmpID.replace(fubID, "").substr(1);
		var objectName = node.getAttribute("name");

		//adapter.log.debug("Registering variable: " + objectID);
		request.put(adapter.config.etaService+"vars/etamon" + objectURI)
		.catch(function (error) {
			adapter.log.info(error);
		})
		.finally(function () {
			adapter.log.silly("Loading variable data: " + adapter.config.etaService+"var"+objectURI);
			request.get(adapter.config.etaService+"var"+objectURI)
			.then(function (content) {
				adapter.log.silly("Loaded: " + content);
				var objData = toXML(content);
	
				var AttUri           = (select('./@uri',           objData));
				var AttStrValue      = (select('./@strValue',      objData));
				var AttUnit          = (select('./@unit',          objData));
				var AttDecPlaces     = (select('./@decPlaces',     objData));
				var AttScaleFactor   = (select('./@scaleFactor',   objData));
				var AttAdvTextOffset = (select('./@advTextOffset', objData));
				var AttText          = (select('./text()',         objData));
	
				var outUnit;
				var outRole = "";
				var outType = "";

				// Set params for object
				if(AttUnit.length>0) {
					outType  = "number";
					outUnit  = AttUnit;
					if(AttUnit=="°C") {
						var outRole  = "value.temperature";
					} else {
						outRole  = "";
					}
				} else {
					outType  = "text";
					outUnit  = AttUnit;
					outRole  = "";
				}
					
				adapter.log.silly("Extending Object: " + objectID + " with type " + outType + " determined from " + objData);
				adapter.extendObject(objectID, {
					type: 'state',
					common: {
						name: objectName,
						type: outType,
						unit: outUnit,
						role: outRole,
						uri: objectURI
					},
					native: {}
				}, function(err) {
					if(!err) {
						adapter.log.silly("*** Object created " + objectID);
					} else {
						adapter.log.error("*** Object not created: "+err);
					}
				});
				if (mapping[objectURI] == null) {
					mapping[objectURI] = [];
				}
				mapping[objectURI].push(objectID);
			})
			.finally(function () {
				createObjects(fubID, objectID, select('./eta:object', node), 0, function() {
					createObjects(fubID, parent, nodes, ++counter, callback);
				});
			});
		});


	} else {
		callback();
	}
}

function init() {
	// Check if the expectedt global variable (etamon) does exist in the ETA device
	request.get(adapter.config.etaService+"vars/etamon")
	.then(function (data) {
		readData(toXML(data));
	})
	.catch(function (error) {
		adapter.log.silly("Create/Fill etamon variable.");
		request.get(adapter.config.etaService+"menu")
		.then(function (menuResponse) {
			menu = toXML(menuResponse);
			adapter.log.silly("** Menu variables read - next: createObjects");
			readFUBs();
		})
		.catch(function (e) {
			adapter.log.error(e);
			adapter.stop();
		});
	});
}

function readMapping(counter) {
	if (counter < variables.length) {
		var variable = variables[counter];
		
		// Read attributes from value node
		var AttStrValue      = (select('./@strValue',      variable)[0].nodeValue);
		var AttUnit          = (select('./@unit',          variable)[0].nodeValue);
		var AttScaleFactor   = (select('./@scaleFactor',   variable)[0].nodeValue);
		var AttText          = (select('./text()',         variable)[0].nodeValue);
		var uri				 = (select('./@uri',		   variable)[0].nodeValue);

		//adapter.log.debug("Determining objectID from mapping for: " + uri);
		var objects = mapping["/" + uri];

		// Set params for object
		var outValue;
		if(AttUnit.length>0) {
			outValue = (AttText * 1.0) / (AttScaleFactor * 1.0);
		} else {
			outValue = AttStrValue;
		}

		for (var obj in objects) {
			var objectID = adapter.name + "." + adapter.instance + "." + objects[obj];
			adapter.setState(objectID, outValue, true);
			adapter.log.debug("Set state of " + objectID + " to " + outValue);
		}
		readMapping(++counter);
	} else {
		adapter.log.debug("Done reading data");
		adapter.stop();
	}
}

function readData(data) {
	variables = (select('//eta:variable', data));
	doReadData();
}

function doReadData() {
	adapter.log.debug("Reading data now: " +  variables.length);

	if (mapping) {
		readMapping(0);
	} else {
		adapter.getState(adapter.name + "." + adapter.instance + ".mapping", function (err, state) {
			if (!err) {
				adapter.log.debug("Fetched mapping");
				mapping = JSON.parse(state.val);
				readMapping(0);
			} else {
				adapter.stop();
			}		
		});
	}
}

function deleteEtamonVariable() {
	adapter.log.debug("** Deleting ETA variabel etamon");
	request.delete(adapter.config.etaService+"vars/etamon")
	.then(function(response) {
		adapter.log.debug("** ETA variable deleted!");
	})
	.catch(function(e) {
		adapter.log.debug("** No ETA variable etamon found to delete");
	})
	.finally(function () {
		init();
	});
}

function main() {
	if (adapter.config.etaDebug) {
		deleteEtamonVariable();
	} else {
		init();
	}
}
