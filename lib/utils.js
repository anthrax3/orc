/**
 * @module orc/utils
 */

'use strict';

const https = require('https');
const stream = require('stream');
const assert = require('assert');
const secp256k1 = require('secp256k1');
const HDKey = require('hdkey');
const constants = require('./constants');
const crypto = require('crypto');
const semver = require('semver');
const ip = require('ip');


/**
 * Returns the SHA-256 hash of the input
 * @param {string|buffer} input - Data to hash
 * @param {string} encoding - The encoding type of the data
 * @returns {buffer}
 */
module.exports.sha256 = function(input, encoding) {
  return crypto.createHash('sha256').update(input, encoding).digest();
};

/**
 * Returns the RIPEMD-160 hash of the input
 * @param {string|buffer} input - Data to hash
 * @param {string} encoding - The encoding type of the data
 * @returns {buffer}
 */
module.exports.rmd160 = function(input, encoding) {
  return crypto.createHash('rmd160').update(input, encoding).digest();
};

/**
 * Returns the RIPEMD-160 SHA-256 hash of this input
 * @param {string|buffer} input - Data to hash
 * @param {string} encoding - The encoding type of the data
 * @returns {buffer}
 */
module.exports.rmd160sha256 = function(input, encoding) {
  return module.exports.rmd160(module.exports.sha256(input, encoding));
};

/**
 * Returns the next power of two number
 * @param {number} number
 * @returns {number}
 */
module.exports.getNextPowerOfTwo = function(num) {
  return Math.pow(2, Math.ceil(Math.log(num) / Math.log(2)));
};

/**
 * Returns a stringified URL from the supplied contact object
 * @param {array} contact
 * @param {string} contact.0 - Node identity key
 * @param {object} contact.1
 * @param {string} contact.1.hostname
 * @param {string} contact.1.port
 * @param {string} contact.1.protocol
 * @returns {string}
 */
module.exports.getContactURL = function(contact) {
  const [identity, info] = contact;

  return `${info.protocol}//${info.hostname}:${info.port}/${identity}`;
};

/**
 * Returns whether or not the supplied semver tag is compatible
 * @param {string} version - The semver tag from the contact
 * @returns {boolean}
 */
module.exports.isCompatibleVersion = function(version) {
  const local = require('./version').protocol;
  const remote = version;
  const sameMajor = semver.major(local) === semver.major(remote);
  const diffs = ['prerelease', 'prepatch', 'preminor', 'premajor'];

  if (diffs.indexOf(semver.diff(remote, local)) !== -1) {
    return false;
  } else {
    return sameMajor;
  }
};

/**
 * Determines if the supplied contact is valid
 * @param {array} contact - The contact information for a given peer
 * @param {boolean} loopback - Allows contacts that are localhost
 * @returns {boolean}
 */
module.exports.isValidContact = function(contact, loopback) {
  const [, info] = contact;
  const isValidAddr = ip.isV4Format(info.hostname) ||
                      ip.isV6Format(info.hostname) ||
                      ip.isPublic(info.hostname);
  const isValidPort = info.port > 0;
  const isAllowedAddr = ip.isLoopback(info.hostname) ? !!loopback : true;

  return isValidPort && isValidAddr && isAllowedAddr;
};

/**
 * Determines if a value is hexadecimal string
 * @param {*} a - The value to be tested
 * @returns {boolean}
 */
module.exports.isHexaString = function(a) {
  if (typeof a !== 'string') {
    return false;
  }

  return /^[0-9a-fA-F]+$/.test(a);
};

/**
 * Checks if the supplied HD key is valid (base58 encoded) and proper length
 * @param {string} hdKey - The HD key in base 58 encoding
 * @returns {boolean} isValidHDKey
 */
module.exports.isValidHDNodeKey = function(hdKey) {
  return typeof hdKey === 'string' &&
    /^[1-9a-km-zA-HJ-NP-Z]{1,111}$/.test(hdKey);
};

/**
 * Checks if the input is a non-hardened HD key index
 * @param {number} hdIndex - The HD key index
 * @returns {boolean} isValidHDKeyIndex
 */
module.exports.isValidNodeIndex = function(n) {
  return !Number.isNaN(n) && (parseInt(n) === n) && n >= 0 &&
    n <= constants.MAX_NODE_INDEX;
};

/**
 * Returns a HD key object using corrent key derivation path using the
 * given seed
 * @param {buffer} seed64 - 64 byte seed for generating key
 * @returns {HDKey}
 */
module.exports.createComplexKeyFromSeed = function(seed64) {
  assert(Buffer.isBuffer(seed64), 'Seed must be a buffer');
  assert(seed64.length === 64, 'Seed must be 64 bytes in length');

  var hdKey = HDKey.fromMasterSeed(seed64).derive(
    constants.HD_KEY_DERIVATION_PATH
  );

  return hdKey.privateExtendedKey;
};

/**
 * Returns a request object for uploading a shard to a farmer
 * @param {array} farmer - Farmer contact object
 * @param {string} hash - The hash of the shard to upload
 * @param {string} token - The authorized transfer token
 * @param {Agent} [agent]
 * @returns {https.ClientRequest}
 */
module.exports.createShardUploader = function(farmer, hash, token, agent) {
  const [, contact] = farmer;

  function _createUploadStream() {
    return https.request({
      method: 'POST',
      rejectUnauthorized: false,
      protocol: contact.protocol,
      hostname: contact.hostname,
      port: contact.port,
      path: `/shards/${hash}?token=${token}`,
      headers: {
        'content-type': 'application/octet-stream'
      },
      agent: agent
    });
  }

  return new stream.Transform({
    transform: function(chunk, encoding, callback) {
      /* istanbul ignore else */
      if (!this._uploader) {
        this._uploader = _createUploadStream();
        this._uploader.on('response', this.emit.bind(this, 'response'));
        this._uploader.on('error', (err) => {
          this.unpipe();
          this.emit('error', err);
        });
      }

      this._uploader.write(chunk, encoding, callback);
    },
    flush: function(callback) {
      /* istanbul ignore else */
      if (this._uploader) {
        this._uploader.end();
      }
      callback();
    }
  });
};

/**
 * Returns a request object for downloading a shard from a farmer
 * @param {array} farmer - Farmer contact object
 * @param {string} hash - The hash of the shard to upload
 * @param {string} token - The authorized transfer token
 * @param {Agent} [agent]
 * @returns {https.ClientRequest}
 */
module.exports.createShardDownloader = function(farmer, hash, token, agent) {
  const [, contact] = farmer;

  function _createDownloadStream() {
    return https.get({
      rejectUnauthorized: false,
      protocol: contact.protocol,
      hostname: contact.hostname,
      port: contact.port,
      path: `/shards/${hash}?token=${token}`,
      headers: {
        'content-type': 'application/octet-stream'
      },
      agent: agent
    });
  }

  return new stream.Readable({
    read: function() {
      if (!this._downloader) {
        this._downloader = _createDownloadStream();
        this._downloader.on('response', (res) => {
          res
            .on('data', this.push.bind(this))
            .on('error', this.emit.bind(this, 'error'))
            .on('end', this.push.bind(this, null));
        })
        .on('error', this.emit.bind(this, 'error'));
      }
    }
  });
};

/**
 * Returns a cipher stream using aes256-cbc-sha256-hmac using a ECDH secret
 * derived from the given public and private keys
 * @param {buffer} publicKey - SECP256k1 public key bytes
 * @param {buffer} privateKey - SECP256k1 private key bytes
 * @returns {object}
 */
module.exports.createCipher = function(publicKey, privateKey) {
  const secret = secp256k1.ecdh(publicKey, privateKey);
  const cipher = crypto.createCipher('aes-256-cbc-hmac-sha256', secret);

  return cipher;
};

/**
 * Returns a cipher stream using aes256-cbc-sha256-hmac using a ECDH secret
 * derived from the given public and private keys
 * @param {buffer} publicKey - SECP256k1 public key bytes
 * @param {buffer} privateKey - SECP256k1 private key bytes
 * @returns {object}
 */
module.exports.createDecipher = function(publicKey, privateKey) {
  const secret = secp256k1.ecdh(publicKey, privateKey);
  const decipher = crypto.createDecipher('aes-256-cbc-hmac-sha256', secret);

  return decipher;
};

/**
 * Returns the appropriate shard size, number of shards, and number of parity
 * shards for RS encoding/decoding provided the total number of bytes of the
 * complete content
 * @param {number} n - Number of bytes in data
 * @returns {object}
 */
module.exports.getErasureParameters = function(n) {
  let size = 8 * (1024 * 1024);
  let params = {
    shards: 2,
    parity: 1,
    get length() {
      return n + params.padding;
    },
    get size() {
      return params.length / params.shards;
    },
    padding: 0
  };

  function accumulate() {
    if (n > size && params.shards !== 16 && params.parity !== 8) {
      size = size * 8;
      params.shards = params.shards * 2;
      params.parity = params.parity * 2;
      while (!Number.isSafeInteger(params.size)) {
        params.padding++;
      }
      return accumulate();
    } else {
      return params;
    }
  }

  return accumulate();
};

