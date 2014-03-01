#!/usr/bin/env node
/**
 * This script should be hooked to the coin daemon as follow: 
 * 
 * litecoind -blocknotify="/path/to/this/script/blockNotify.js localhost:8117 password litecoin %s"
 * 
 * The above will send tell litecoin to launch this script with those parameters every time
 * a block is found.
 * This script will then send the blockhash along with other informations to a listening tcp socket 
**/

var net       = require('net');
var config    = process.argv[1];
var parts     = config.split(':');
var host      = parts[0];
var port      = parts[1];
var password  = process.argv[2];
var coin      = process.argv[3];
var blockHash = process.argv[4];

var client = net.connect(port, host, function() {
    console.log('client connected');
    client.write(JSON.stringify({
        password: password,
        coin: coin,
        blockHash: blockHash
    }) + '\n');
});

client.on('data', function(data) {
    console.log(data.toString());
    //client.end();
});

client.on('end', function() {
    console.log('client disconnected');
    //process.exit();
});