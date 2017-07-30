/**
 * @module orc/profiles
 */

'use strict';

const async = require('async');
const ms = require('ms');
const Contract = require('./contract');
const Zcash = require('zcash');


/**
 * Base class for a profile, sets up zcash wallet and other shared profile
 * behavior
 */
class Profile {

  /**
   * @constructor
   * @param {Node} node
   * @param {object} config
   */
  constructor(node, config) {
    this.node = node;
    this.config = config;
    this.wallet = this._createWallet();

    this._init();
  }

  /**
   * Generates a new zcash address
   * @param {Profile~getNewAddressCallback} callback
   */
  getNewAddress(callback) {
    if (parseInt(this.config.WalletShieldedTransactions)) {
      this.wallet.z_getnewaddress()
        .then((addr) => callback(null, addr), callback);
    } else {
      this.wallet.getnewaddress()
        .then((addr) => callback(null, addr), callback);
    }
  }
  /**
   * @callback Profile~getNewAddressCallback
   * @param {error|null} error
   * @param {string} address
   */

  /**
   * Creates a zcash wallet instance
   * @private
   */
  _createWallet() {
    return new Zcash({
      username: this.config.WalletUser,
      password: this.config.WalletPassword,
      port: parseInt(this.config.WalletPort),
      host: this.config.WalletHostname
    });
  }

  /**
   * Initializes the profile
   * @private
   */
  _init() {}

}

/**
 * Applies the farmer profile to the supplied node. A farmer publishes capacity
 * announcements, subscribes to contract publications, and reaps stale shards.
 */
class FarmerProfile extends Profile {

  /**
   * @constructor
   * @param {Node} node
   * @param {object} config
   */
  constructor(node, config) {
    super(node, config);
  }

  /**
   * @private
   */
  _init() {
    this.node.logger.info(
      `subscribing to ${this.config.FarmerAdvertiseTopics.length} topic codes`
    );
    this.node.subscribeShardDescriptor(
      this.config.FarmerAdvertiseTopics,
      (err, rs) => rs.on('data', (data) => this._handleContract(...data))
    );

    this.announceCapacity();

    setInterval(() => this.announceCapacity(),
                ms(this.config.FarmerAnnounceInterval));
    setInterval(() => this.reapExpiredShards(),
                ms(this.config.FarmerShardReaperInterval));
  }

  /**
   * Handles incoming contract publications and sends storage offer
   * @private
   * @param {object} contract
   * @param {array} contact
   */
  _handleContract(contract, contact) {
    contract = Contract.from(contract);

    this.getNewAddress((err, addr) => {
      /* istanbul ignore if */
      if (err) {
        this.node.logger.error(err.message);
        return this.node.logger.warn(
          'cannot send offer for shard, failed to get new address from wallet'
        );
      }

      contract.set('farmer_id', this.node.identity.toString('hex'));
      contract.set('farmer_hd_key', this.node.contact.xpub);
      contract.set('farmer_hd_index', this.node.contact.index);
      contract.set('payment_destination', addr);
      contract.sign('farmer', this.node.spartacus.privateKey);

      contract = contract.toObject();

      this.node.offerShardAllocation(contact, contract, (err) => {
        /* istanbul ignore if */
        if (err) {
          this.node.logger.info(`offer rejected, reason: ${err.message}`);
        } else {
          this.node.logger.info(
            `acquired storage contract ${contract.data_hash} ` +
            `from renter node ${contact[0]}`
          );
        }
      });
    });
  }

  /**
   * Announces current storage capacity to neighbors
   * @param {FarmerProfile~announceCapacityCallback} callback
   */
  announceCapacity(callback = () => null) {
    this.node.shards.size((err, data) => {
      /* istanbul ignore if */
      if (err) {
        return this.node.logger.warn('failed to measure capacity');
      }

      async.eachSeries(this.config.FarmerAdvertiseTopics, (topic, next) => {
        this.node.publishCapacityAnnouncement(topic, data, (err) => {
          /* istanbul ignore if */
          if (err) {
            this.node.logger.error(err.message);
            this.node.logger.warn('failed to publish capacity announcement');
          } else {
            this.node.logger.info('published capacity announcement ' +
              `${data.available}/${data.allocated}`
            );
          }
          next();
        });
      }, callback);
    });
  }
  /**
   * @callback FarmerProfile~announceCapacityCallback
   * @param {error|null} error
   */

  /**
   * Scans the contract database for expired shards and reaps them from storage
   * @param {FarmerProfile~reapExpiredShardsCallback} callback
   */
  reapExpiredShards(callback = () => null) {
    const time = Date.now();
    const rs = this.node.contracts.createReadStream();

    this.node.logger.info('starting contract database scan for stale shards');

    rs.on('data', ({ key, value }) => {
      let contract = Contract.from(value);

      rs.pause();

      if (contract.get('store_end') < (time + ms('24h'))) {
        this.node.shards.unlink(contract.get('data_hash'), (err) => {
          if (err) {
            this.node.logger.warn(`failed to reap shard ${value.data_hash}`);
            rs.resume();
          } else {
            this.node.logger.info(`unlinked stale shard ${value.data_hash}`);
            this.node.contracts.del(key, () => rs.resume());
          }
        });
      } else {
        rs.resume();
      }
    });

    rs.on('end', () => {
      this.node.logger.info('finished reaping stale shards');
      callback(null);
    });

    rs.on('error', (err) => {
      this.node.logger.error(err.message);
      this.node.logger.warn('did not complete reaping stale shards');
      callback(err);
    });
  }
  /**
   * @callback FarmerProfile~reapExpiredShardsCallback
   * @param {error|null} error
   */

}

/**
 * Applies the renter profile to the supplied node. A renter listens for
 * capacity announcements and keeps a cache, exposes a local bridge for
 * upload/download, handles auditing, mirroring, and payments.
 */
class RenterProfile extends Profile {

  /**
   * @constructor
   * @param {Node} node
   * @param {object} config
   */
  constructor(node, config) {
    super(node, config);
  }

  /**
   * @private
   */
  _init() {
    this.node.logger.info('subscribing to network capacity announcements');
    this.node.subscribeCapacityAnnouncement(
      this.config.RenterListenTopics,
      (err, rs) => {
        rs.on('data', ([capacity, contact]) => {
          let timestamp = Date.now();
          this.node.capacity.set(contact[0], { capacity, contact, timestamp });
        });
      }
    );
    setInterval(() => this.node.capacity.compact(), ms('30M'));
  }

}

/**
 * Applies the directory profile to the supplied node. A directory listens for
 * capacity announcements and keeps a cache, exposes a public API for showing
 * network statistics.
 */
class DirectoryProfile extends Profile {

  /**
   * @constructor
   * @param {Node} node
   * @param {object} config
   */
  constructor(node, config) {
    super(node, config);
  }

  /**
   * @private
   */
  _init() {
    this.node.logger.info('subscribing to network capacity announcements');
    this.node.subscribeCapacityAnnouncement(
      this.config.RenterListenTopics,
      (err, rs) => {
        rs.on('data', ([capacity, contact]) => {
          let timestamp = Date.now();
          this.node.capacity.set(contact[0], { capacity, contact, timestamp });
        });
      }
    );
  }

}

/**
 * Applies the farmer profile
 * @function
 * @param {Node} node
 * @param {object} config
 * @returns {FarmerProfile}
 */
module.exports.farmer = function(node, config) {
  node.profiles = node.profiles || {};
  node.profiles.farmer = new FarmerProfile(node, config);

  return node.profiles.farmer;
};

/**
 * Applies the renter profile
 * @function
 * @param {Node} node
 * @param {object} config
 * @returns {RenterProfile}
 */
module.exports.renter = function(node, config) {
  node.profiles = node.profiles || {};
  node.profiles.renter = new RenterProfile(node, config);

  return node.profiles.renter;
};

/**
 * Applies the directory profile
 * @function
 * @param {Node} node
 * @param {object} config
 * @returns {DirectoryProfile}
 */
module.exports.directory = function(node, config) {
  node.profiles = node.profiles || {};
  node.profiles.directory = new DirectoryProfile(node, config);

  return node.profiles.directory;
};

/** @private */
module.exports.Profile = Profile;
/** @private */
module.exports.FarmerProfile = FarmerProfile;
/** @private */
module.exports.RenterProfile = RenterProfile;
/** @private */
module.exports.DirectoryProfile = DirectoryProfile;
