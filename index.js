const { EventEmitter } = require('events')
const { TransactionFactory } = require('@ethereumjs/tx')
const ethUtil = require('ethereumjs-util')
const DcentConnector = require('dcent-web-connector')

const DefaultKeyPathString = `m/44'/60'/0'/0/0`
const keyringType = 'DCENT Hardware'
const DCENT_TIMEOUT = 60000
const DcentResult = {
  SUCCESS: 'success',
  ERROR: 'error',
}

let LOG
if (process.env.NODE_ENV !== 'production') {
  // LOG = console.log.bind(console, '[LOG]')
  LOG = () => {}
} else {
  LOG = () => {}
}

const splitPath = path => {
  return path.split('/').filter(item => item.trim() !== '')
}
const hardenedIdx = [1, 2, 3]
const isHardened = idx => {
  return hardenedIdx.includes(idx)
}

const getFullPath = (path, idx) => {
  const pieces = splitPath(path)
  let fullpath = 'm'
  for (let i = 1; i < 6; i++) {
    if (i < pieces.length) {
      fullpath += `/${pieces[i]}`
    } else if (i === pieces.length) {
      fullpath += `/${idx}`
    } else {
      fullpath += `/0`
    }
    if (isHardened(i) && !fullpath.endsWith("'")) {
      fullpath += "'"
    }
  }
  return fullpath
}

const coinType = DcentConnector.coinType
const getCoinType = path => {
  let type
  switch (/m\/44'\/(\d+)'/g.exec(path)[1]) {
    case '0':
      type = coinType.BITCOIN
      break
    case '1':
      type = coinType.BITCOIN_TESTNET
      break
    case '60':
      type = coinType.ETHEREUM
      break
    case '137':
      type = coinType.RSK
      break
    case '144':
      type = coinType.RIPPLE
      break
    case '22':
      type = coinType.MONACOIN
      break
    case '8217':
      type = coinType.KLAYTN
      break
    default:
      throw new Error('Not Supported path')
  }
  return type
}

const getTypedTxOption = (type, transactionJson) => {
  if (type === 1 || type === 2) {
    const optParams = {}
    optParams.accessList = transactionJson.accessList
    if (type === 2) {
      optParams.maxPriorityFeePerGas = transactionJson.maxPriorityFeePerGas
      optParams.maxFeePerGas = transactionJson.maxFeePerGas
    }

    return optParams
  }

  return {}
}

function isOldStyleEthereumjsTx (tx) {
  return typeof tx.getChainId === 'function'
}


class DcentKeyring extends EventEmitter {
  constructor (opts = {}) {
    super()
    this.type = keyringType
    this.accounts = []
    this._accounts = []
    this.page = 0
    this.perPage = 1 // support only one account
    this.unlockedAccount = 0
    // this.paths = {}
    this.deserialize(opts)
    DcentConnector.setTimeOutMs(opts.timeOut || DCENT_TIMEOUT)
  }

  getModel () {
    return 'DCENT Biometric Wallet'
  }

  serialize () {
    return Promise.resolve({
      accounts: this.accounts,
      _accounts: this._accounts,
      hdPath: this.hdPath,
      // page: this.page,
      // paths: this.paths,
      // perPage: this.perPage,
      unlockedAccount: this.unlockedAccount,
    })
  }

  deserialize (opts = {}) {
    this.accounts = opts.accounts || []
    this._accounts = opts._accounts || []
    this.hdPath = opts.hdPath || DefaultKeyPathString
    // this.page = opts.page || 0
    // this.perPage = opts.perPage || 1
    this.path = getFullPath(this.hdPath, 0)
    this.coinType = getCoinType(this.path)
    return Promise.resolve()
  }

  isUnlocked () {
    LOG('isUnlocked - ', Boolean(this._accounts && this._accounts.length !== 0))
    return Boolean(this._accounts && this._accounts.length !== 0)
  }

  unlock () {
    LOG('unlock ENTER')
    if (this.isUnlocked()) {
      return Promise.resolve(this._accounts[0]) // return first account address
    }
    return new Promise((resolve, reject) => {
      DcentConnector.getAddress(
        this.coinType,
        this.path
      ).then((response) => {
        if (response.header.status === DcentResult.SUCCESS) {
          LOG('getAddress return - ', response.body.parameter.address)
          this._accounts = [ response.body.parameter.address ]
          resolve(response.body.parameter.address) // return address of first account
        } else if (response.body.error) {
          reject(new Error(`${response.body.error.code} - ${response.body.error.message}`))
        } else {
          reject(new Error(`Unknown error - ${response}`))
        }
      }).catch((e) => {
        if (e.body.error) {
          reject(new Error(`${e.body.error.code} - ${e.body.error.message}`))
        } else {
          reject(new Error(`Unknown error - ${e}`))
        }
      }).finally((_) => {
        DcentConnector.popupWindowClose()
      })
    })
  }

  setAccountToUnlock (index) {
    LOG('setAccountToUnlock ENTER')
    this.unlockedAccount = parseInt(index, 10)
  }

  addAccounts (n = 1) {
    LOG('addAccounts ENTER')
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((address) => {
          this.accounts = []
          this.accounts.push(address)
          this.page = 0
          LOG('addAccounts - ', this.accounts)
          resolve(this.accounts)
        })
        .catch((e) => {
          reject(e)
        })
    })
  }

  getFirstPage () {
    LOG('getFirstPage ENTER')
    this.page = 0
    return this.__getPage(1)
  }

  getNextPage () {
    LOG('getNextPage ENTER')
    return this.__getPage(1)
  }

  getPreviousPage () {
    LOG('getPreviousPage ENTER')
    return this.__getPage(-1)
  }

  __getPage (increment) {
    this.page = 1

    return new Promise((resolve, reject) => {
      this.unlock()
        .then((address) => {
          // support only 1 account
          const accounts = []
          accounts.push({
            address,
            balance: null,
            index: 0,
          })
          // this.paths[ethUtil.toChecksumAddress(address)] = 0
          LOG('__getPage return accounts - ', accounts)
          resolve(accounts)
        })
        .catch((e) => {
          reject(e)
        })
    })
  }

  getAccounts () {
    return Promise.resolve(this.accounts.slice())
  }

  removeAccount (address) {
    if (!this.accounts.map((a) => a.toLowerCase()).includes(address.toLowerCase())) {
      throw new Error(`Address ${address} not found in this keyring`)
    }
    this.accounts = this.accounts.filter((a) => a.toLowerCase() !== address.toLowerCase())
  }

  // tx is an instance of the ethereumjs-transaction class.
  signTransaction (address, tx) {
    if (isOldStyleEthereumjsTx(tx)) { // old style transaction
      tx.v = ethUtil.bufferToHex(tx.getChainId())
      tx.r = '0x00'
      tx.s = '0x00'

      return this._signTransaction(address, tx.getChainId(), tx)
    }

    return this._signTransaction(
      address,
      tx.common.chainIdBN().toNumber(),
      tx
    )
  }

  _signTransaction (address, chainId, tx) {

    let transaction
    let txType = 0
    if (isOldStyleEthereumjsTx(tx)) {
      // legacy transaction from ethereumjs-tx package has no .toJSON() function,
      // so we need to convert to hex-strings manually manually
      transaction = {
        to: this._normalize(tx.to),
        value: this._normalize(tx.value),
        data: this._normalize(tx.data),
        chainId,
        nonce: this._normalize(tx.nonce),
        gasLimit: this._normalize(tx.gasLimit),
        gasPrice: this._normalize(tx.gasPrice),
      }
    } else {
      if (tx._type === 1 || tx._type === 2) {
        txType = tx._type
      }

      transaction = {
        ...tx.toJSON(),
        chainId,
        to: this._normalize(tx.to),
      }
    }
    transaction.nonce = (transaction.nonce === '0x') ? '0x0' : transaction.nonce
    transaction.value = (transaction.value === '0x') ? '0x0' : transaction.value
    const typedOpstions = getTypedTxOption(txType, transaction)
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((_) => {
          DcentConnector.getEthereumSignedTransaction(
            this.coinType,
            transaction.nonce,
            transaction.gasPrice,
            transaction.gasLimit,
            transaction.to,
            transaction.value,
            transaction.data,
            this.path, // key path
            transaction.chainId,
            txType,
            typedOpstions
          ).then((response) => {
            LOG('response - ', response)
            if (response.header.status === DcentResult.SUCCESS) {
              const parameter = response.body.parameter
              const signedBuffer = Buffer.from(parameter.signed, 'hex')
              const tempTx = TransactionFactory.fromSerializedData(signedBuffer)

              let signedTx = tx
              if (isOldStyleEthereumjsTx(tx)) {
                signedTx.v = Buffer.from(ethUtil.stripHexPrefix(parameter.sign_v), 'hex')
                signedTx.r = Buffer.from(ethUtil.stripHexPrefix(parameter.sign_r), 'hex')
                signedTx.s = Buffer.from(ethUtil.stripHexPrefix(parameter.sign_s), 'hex')
              } else {
                signedTx = tempTx
              }

              const addressSignedWith = ethUtil.toChecksumAddress(
                ethUtil.addHexPrefix(
                  tempTx.getSenderAddress().toString('hex'),
                ),
              )
              const correctAddress = ethUtil.toChecksumAddress(address)
              if (addressSignedWith !== correctAddress) {
                reject(new Error("signature doesn't match the right address"))
              }
              LOG('signedTx - ', signedTx)
              resolve(signedTx)
            } else if (response.body.error) {
              reject(new Error(`${response.body.error.code} - ${response.body.error.message}`))
            } else {
              reject(new Error(`Unknown error - ${response}`))
            }

          }).catch((e) => {
            if (e && e.body && e.body.error) {
              reject(new Error(`${e.body.error.code} - ${e.body.error.message}`))
            } else {
              reject(new Error(`Unknown error - ${e}`))
            }
          }).finally((_) => {
            DcentConnector.popupWindowClose()
          })
        }).catch((e) => {
          if (e.body.error) {
            reject(new Error(`${e.body.error.code} - ${e.body.error.message}`))
          } else {
            reject(new Error(`Unknown error - ${e}`))
          }
        })
    })

  }

  signMessage (withAccount, data) {
    return this.signPersonalMessage(withAccount, data)
  }

  // For personal_sign, we need to prefix the message:
  signPersonalMessage (withAccount, message) {
    LOG('signPersonalMessage - withAccount', withAccount)
    LOG('signPersonalMessage - message', message)
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((_) => {
          DcentConnector.getEthereumSignedMessage(
            message,
            this.path
          ).then((response) => {
            if (response.header.status === DcentResult.SUCCESS) {
              if (response.body.parameter.address !== ethUtil.toChecksumAddress(withAccount)) {
                reject(new Error('signature doesnt match the right address'))
              }
              resolve(response.body.parameter.sign)
            } else if (response.body.error) {
              reject(new Error(`${response.body.error.code} - ${response.body.error.message}`))
            } else {
              reject(new Error(`Unknown error - ${response}`))
            }
          }).catch((e) => {
            if (e.body.error) {
              reject(new Error(`${e.body.error.code} - ${e.body.error.message}`))
            } else {
              reject(new Error(`Unknown error - ${e}`))
            }
          }).finally((_) => {
            DcentConnector.popupWindowClose()
          })

        }).catch((e) => {
          if (e.body.error) {
            reject(new Error(`${e.body.error.code} - ${e.body.error.message}`))
          } else {
            reject(new Error(`Unknown error - ${e}`))
          }
        })
    })
  }

  signTypedData (withAccount, typedData, opts) {
    // Waiting on dcent to enable this
    LOG('signPersonalMessage - withAccount', withAccount)
    LOG('signTypedData - typedData', typedData)

    return new Promise((resolve, reject) => {
      this.unlock()
        .then((_) => {
          DcentConnector.getSignedData(
            this.path,
            { payload: typedData, version: opts.version }
          ).then((response) => {
            if (response.header.status === DcentResult.SUCCESS) {
              if (response.body.parameter.address !== ethUtil.toChecksumAddress(withAccount)) {
                reject(new Error('signature doesnt match the right address'))
              }
              resolve(response.body.parameter.sign)
            } else if (response.body.error) {
              reject(new Error(`${response.body.error.code} - ${response.body.error.message}`))
            } else {
              reject(new Error(`Unknown error - ${response}`))
            }
          }).catch((e) => {
            if (e.body.error) {
              reject(new Error(`${e.body.error.code} - ${e.body.error.message}`))
            } else {
              reject(new Error(`Unknown error - ${e}`))
            }
          }).finally((_) => {
            DcentConnector.popupWindowClose()
          })

        }).catch((e) => {
          if (e && e.body && e.body.error) {
            reject(new Error(`${e.body.error.code} - ${e.body.error.message}`))
          } else {
            reject(new Error(`Unknown error - ${e}`))
          }
        })
    })
  }

  exportAccount (address) {
    return Promise.reject(new Error('Not supported on this device'))
  }

  forgetDevice () {
    this.accounts = []
    this._accounts = []
    this.page = 0
    this.unlockedAccount = 0
    // this.paths = {}
  }

  /* PRIVATE METHODS */

  _normalize (buf) {
    return ethUtil.bufferToHex(buf).toString()
  }

}

DcentKeyring.type = keyringType
module.exports = DcentKeyring
