const Queue = require('better-queue')
const axios = require('axios')
const EtagRequest = require('./EtagRequest')

class RequestQueue {
    constructor({
        concurrent = 10, 
        maxTimeout = 10000, 
        maxRetries = 3, 
        retryDelay = 10000,
        cacheGet = null,
        cacheSet = null,
        reporter = null,
    }) {
        this._okToRequest = true
        this._lastBackoff = 0
        this._currentBackoffTimer = false
        this._settings = {
            concurrent,
            maxTimeout,
            maxRetries,
            retryDelay,
        }
        this._queue = new Queue(this.handleQueueItem, {
            ...this._settings,
            preconditionRetryTimeout: 1000,
            precondition: this.okToRequest,
        })
        if ( typeof cacheGet === "function" && typeof cacheSet === "function" ){
            this._instance = new EtagRequest({cacheGet, cacheSet})
        } else {
            this._instance = axios.create()
        }
        this._reporter = reporter
    }

    push = async (item) => {
        const self = this
        return new Promise( (resolve, reject) => {
            self._queue.push(item)
                .on('finish', (result) => {
                    resolve(result)
                })
                .on('failed', (err) => {
                    reject(err)
                })
        })
    }

    warn (msg) {
        if (typeof this?._reporter?.warn !== "undefined") {
            this._reporter.warn(msg)
        } else {
            console.warn(msg)
        }
    }

    log (msg) {
        if (typeof this?._reporter?.verbose !== "undefined" ) {
            this._reporter.verbose(msg)
        }
    }

    stats() {
        return this._queue.getStats()
    }

    handleQueueItem = async (item, cb) => {
        const self = this
        this.log(`fetching ${item.url}`)
        try {
            const filteredItem = ({ auth, headers, params }) => ({ auth, headers, params })
            const request = await axios.get(item.url, {
                ...filteredItem(item),
                timeout: self._settings.maxTimeout - 100
            })
            // item._resolver(request)
            cb(null, request)
        } catch (error) {
            // console.error(`${item.url} failed`)
            // debugger
            if ( error?.isAxiosError ) {
                if ( error.code === 'ECONNABORTED' ) {
                    // Timeout.
                    this.warn(`${item.url} timed out`)
                    self.backOff()
                    cb(error)
                    return
                }
                if ( error?.response?.status >= 500 ) {
                    // there's an issue with the server, so let's backoff and retry
                    self.backOff()
                    cb(error)
                    return
                }
                // let the application deal with any other error codes
                // item._resolver(error)
                cb(null, error)
                return
            }
            this.warn(`${item.url} failed: ${error.message}`)            
            cb(error)
        }
    }

    backOff = () => {
        if ( !this._currentBackoffTimer ) {
            this._okToRequest = false
            this._lastBackoff += 1000
            const seconds = this._lastBackoff / 1000
            console.log(`backing off more requests for ${seconds}`)
            this._currentBackoffTimer = setTimeout(() => {
                console.log('resuming')
                this._okToRequest = true;
                this._currentBackoffTimer = false
            }, this._lastBackoff)
        }
    }

    okToRequest = (cb) => {
        cb(null, this._okToRequest)
    }

}

module.exports = RequestQueue