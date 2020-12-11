const axios = require(`axios`)
const crypto = require("crypto")

class EtagRequest {
    constructor({cacheGet, cacheSet}) {
        this._cacheGet = cacheGet
        this._cacheSet = cacheSet
        this._instance = axios.create()
        const self = this
        this._instance.interceptors.request.use(
            (r) => {
                return self.beforeRequest(r)
            }
        )
        this._instance.interceptors.response.use(
            (r) => {
                return self.beforeResponse(r)
            },
            (r) => {
                return self.responseError(r)
            }
        )
    }

    get(url, config) {
        return this._instance.get(url, config)
    }

    _key(url) {
        const sha = crypto
        .createHash("sha1")
        .update(url)
        .digest("base64");
        return `etagRequest-${sha}`
    }

    cacheGet(url) {
        const key = this._key(url)
        return this._cacheGet(key)
    }

    cacheSet(url, response) {
        const key = this._key(url)
        return this._cacheSet(key, response)
    }

    async beforeRequest(config) {
        const cacheObj = await this.cacheGet(config.url)
        if ( cacheObj ) {
            // set etag headers
            // curl -i -H "If-None-Match: \"1607706964\"" 
            // config.headers["If-None-Match"]
            if ( cacheObj?.headers?.etag ) {
                config.headers = {
                    ...config.headers,
                    'If-None-Match': cacheObj?.headers?.etag,
                }
            }
        }
        return config
    }

    async beforeResponse(response) {
        await this.cacheSet(response.config.url, response)
        return response
    }

    async responseError(error) {
        if (error.response && error.response.status === 304) {
            const cachedResponse = await this.cacheGet(error.config.url)
            if ( ! cachedResponse ) {
                return Promise.reject(error)
            }
            const response = error.response
            response.status = 200
            response.data = cachedResponse.data
            return Promise.resolve(response)
        }
        return Promise.reject(error)
    }

}

module.exports = EtagRequest