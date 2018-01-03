var Stratum = require('stratum-pool');
var redis = require('redis');
var net = require('net');

var ShareProcessor = require('./shareProcessor.js');

module.exports = function (logger) {

    var _this = this;

    var poolConfigs = JSON.parse(process.env.pools);
    var portalConfig = JSON.parse(process.env.portalConfig);

    var forkId = process.env.forkId;

    var pools = {};

    var redisClient = redis.createClient(portalConfig.redis.port, portalConfig.redis.host, {db: 1});
    if (portalConfig.redis.password) {
        redisClient.auth(portalConfig.redis.password);
    }
    //Handle messages from master process sent via IPC
    process.on('message', function (message) {
        switch (message.type) {

            case 'banIP':
                for (var p in pools) {
                    if (pools[p].stratumServer)
                        pools[p].stratumServer.addBannedIP(message.ip);
                }
                break;

            case 'blocknotify':

                var messageCoin = message.coin.toLowerCase();
                var poolTarget = Object.keys(pools).filter(function (p) {
                    return p.toLowerCase() === messageCoin;
                })[0];

                if (poolTarget)
                    pools[poolTarget].processBlockNotify(message.hash, 'blocknotify script');

                break;
        }
    });


    Object.keys(poolConfigs).forEach(function (coin) {

        var poolOptions = poolConfigs[coin];

        var logSystem = 'Pool';
        var logComponent = coin;
        var logSubCat = 'Thread ' + (parseInt(forkId) + 1);

        var handlers = {
            auth: function () {
            },
            share: function () {
            },
            diff: function () {
            }
        };

        //Functions required for internal payment processing

        var shareProcessor = new ShareProcessor(logger, poolOptions);

        handlers.auth = function (port, workerName, password, authCallback) {
            if (poolOptions.validateWorkerUsername !== true)
                authCallback(true);
            else {
                pool.daemon.cmd('validateaddress', [String(workerName).split(".")[0]], function (results) {
                    var isValid = results.filter(function (r) {
                        return r.response.isvalid
                    }).length > 0;
                    authCallback(isValid);
                });
            }
        };

        handlers.share = function (isValidShare, isValidBlock, data) {
            shareProcessor.handleShare(isValidShare, isValidBlock, data);
        };


        var authorizeFN = function (ip, port, workerName, password, callback) {
            handlers.auth(port, workerName, password, function (authorized) {

                var authString = authorized ? 'Authorized' : 'Unauthorized ';

                logger.debug(logSystem, logComponent, logSubCat, authString + ' ' + workerName + ':' + password + ' [' + ip + ']');
                callback({
                    error: null,
                    authorized: authorized,
                    disconnect: false
                });
            });
        };


        var pool = Stratum.createPool(poolOptions, authorizeFN, logger);
        pool.on('share', function (isValidShare, isValidBlock, data) {

            var shareData = JSON.stringify(data);

            if (data.blockHash && !isValidBlock)
                logger.debug(logSystem, logComponent, logSubCat, 'We thought a block was found but it was rejected by the daemon, share data: ' + shareData);

            else if (isValidBlock)
                logger.debug(logSystem, logComponent, logSubCat, 'Block found: ' + data.blockHash + ' by ' + data.worker);

            if (isValidShare) {
                if (data.shareDiff > 1000000000) {
                    logger.debug(logSystem, logComponent, logSubCat, 'Share was found with diff higher than 1.000.000.000!');
                } else if (data.shareDiff > 1000000) {
                    logger.debug(logSystem, logComponent, logSubCat, 'Share was found with diff higher than 1.000.000!');
                }
                //logger.debug(logSystem, logComponent, logSubCat, 'Share accepted at diff ' + data.difficulty + '/' + data.shareDiff + ' by ' + data.worker + ' [' + data.ip + ']' );
            } else if (!isValidShare) {
                logger.debug(logSystem, logComponent, logSubCat, 'Share rejected: ' + shareData);
            }

            // handle the share
            handlers.share(isValidShare, isValidBlock, data);

            // send to master for pplnt time tracking
            process.send({
                type: 'shareTrack',
                thread: (parseInt(forkId) + 1),
                coin: poolOptions.coin.name,
                isValidShare: isValidShare,
                isValidBlock: isValidBlock,
                data: data
            });

        }).on('difficultyUpdate', function (workerName, diff) {
            logger.debug(logSystem, logComponent, logSubCat, 'Difficulty update to diff ' + diff + ' workerName=' + JSON.stringify(workerName));
            handlers.diff(workerName, diff);
        }).on('log', function (severity, text) {
            logger[severity](logSystem, logComponent, logSubCat, text);
        }).on('banIP', function (ip, worker) {
            process.send({type: 'banIP', ip: ip});
        }).on('started', function () {
            logger.debug(logSystem, logComponent, logSubCat, 'Stratum started');
        });

        pool.start();
        pools[poolOptions.coin.name] = pool;
    });
};
