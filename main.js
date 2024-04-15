//Queue-Fair Akamai Adapter v2.1.1 Copyright Matt King 2024 see LICENCE in this distribution for more details.

import { TextDecoder, TextEncoder, base64 } from 'encoding'
import { httpRequest } from 'http-request'
import { crypto } from 'crypto'
import { logger } from 'log'

const encoder = new TextEncoder()
const compiledSecrets = []
const waiting = []

const config = {
// PMUSER_QF_ACCOUNT_SECRET
// Your Account Secret is shown on the Your Account page of
// the Queue-Fair Portal.If you change it there, you must
// change it here too. MUST NOT be the secret of any queue.
  accountSecret : 'ACCOUNT_SECRET_FROM_YOUR_ACCOUNT_PAGE_IN_PORTAL',

// PMUSER_QF_ACCOUNT_SYSTEM_NAME
// The System Name of your account from the Your Account page
// of the Queue-Fair Portal. MUST NOT be the system name of any queue.
  account : 'ACCOUNT_SYSTEM_NAME_FROM_YOUR_ACCOUNT_PAGE_IN_PORTAL',

// PMUSER_QF_QUERY_VALIDITY_SECONDS
// Time limit for Passed Strings to be considered valid,
// before and after the current time
  queryTimeLimitSeconds : 30,

// PMUSER_QF_DEBUG
// set to true to enable debug logging output.
  debug : false,

// PMUSER_QF_TIMEOUT_SECONDSS
// How long to wait in seconds for network reads of config
// or Adapter Server (safe mode only)
  readTimeout : 10,

// PMUSER_QF_SETTINGS_CACHE_MINUTES
// How long a cached copy of your Queue-Fair settings will be kept before
// downloading a fresh copy. Set this to 0 if you are updating your settings in
// the Queue-Fair Portal and want to test your changes quickly, but remember
// to set it back to at least 5 again when you are finished to reduce CloudFlare costs.
// NOTE: If you set this to one minute or less in a production environment, you will
// exceed the CloudFlare free plan KV limit of 1000 writes per day!
  settingsCacheLifetimeMinutes : 5,

// PMUSER_QF_STRIP_PASSED
// Whether or not to strip the Passed String from the URL
// that the Visitor sees on return from the Queue or Adapter servers
// (simple mode) - when set to true causes one additinal HTTP request
// to CloudFlare but only on the first matching visit from a particular
// visitor. The recommended value is true.
  stripPassedString : true,

// PMUSER_QF_MODE
// Whether to send the visitor to the Adapter server for counting (simple mode),
// or consult the Adapter server (safe mode).The recommended value is 'safe'.
// If you change this to 'simple', consider setting stripPassedString above to
// false to make it easier for Google to crawl your pages.
  adapterMode : 'safe',

// PMUSER_QF_ALWAYS_HTTPS
// When the queue is turned on and showing queue pages, always send a visitor
// from the front of the queue to a URL on your site starting 'https://'
// even if Akamai has told us that they wanted a URL starting 'http://',
// which can happen with some Akamai set-ups involving multiple
// reverse proxies.  Setting is only active if Dynamic Targeting is in use.
// Leave this set to true if your whole site is protected by https.
  alwaysHTTPS : false,

// PMUSER_QF_SEND_URL
// When enabled the URL of any visitor request that results in an Adapter call to
// the Queue Server cluster is sent to the cluster for logging, which is occasionally
// useful for investigations.  Only applies to SAFE mode.
// May be set to false for production systems once we have verified the IP address
// has been successfully received.
  sendURL : true,

// PMUSER_QF_EXCLUDE_FILE_TYPES (comma separated list)
// An array of commonly used file extensions on which the Adapter will automatically
// NOT Match. Equivalent to AND Path Does Not Contain .xxx in the
// Portal Activation Rules.  Preferably, set these as Does Not Match paths in your
// Adapter Rule Criteria in Control Centre.
  excludeFileTypes : [ 'json', 'xml', 'css', 'js', 'webmanifest', 'txt',  //static file types
  'jpeg', 'jpg', 'gif', 'png', 'webp', 'svg', 'bmp', 'ico', //Image types
  'mpeg','mpg','mp4','wav','mp3','pdf',  //media types
  'woff','woff2','ttf','eot'  //font types
  ],

// Append this port number to target URLs used with Dynamic Targeting.
// Set to -1 to disable in production systems. Set to 9550 if running Adapter in Sandbox.
  targetPort : -1,

}

function setUpConfigVariable(req,key,prop,type = 'string',sep=',') {
  logger.log('PMUSER_QF_'+key+" "+req.getVariable('PMUSER_QF_'+key));
  if(typeof req.getVariable('PMUSER_QF_'+key) === 'undefined')
    return
  let i = req.getVariable('PMUSER_QF_'+key)
  let o = 'unset'
  switch(type) {
  case 'list':
    o = i.split(sep)
    break
  case 'bool':
    o = (i == 'true')
    break
  case 'int':
    o = parseInt(i)
    break
  default:
  case 'string':
    o = i
    break
  }
  config[prop] = o
}

function setUpConfig(req) {
  setUpConfigVariable(req,'ACCOUNT_SYSTEM_NAME','account')
  setUpConfigVariable(req,'ACCOUNT_SECRET','accountSecret')
  setUpConfigVariable(req,'DEBUG','debug','bool')
  setUpConfigVariable(req,'QUERY_VALIDITY_SECONDS','queryTimeLimitSeconds','int')
  setUpConfigVariable(req,'TIMEOUT_SECONDS','readTimeout','int')
  setUpConfigVariable(req,'SETTINGS_CACHE_MINUTES','settingsCacheLifetimeMinutes','int')
  setUpConfigVariable(req,'STRIP_PASSED_STRING','stripPassedString','bool')
  setUpConfigVariable(req,'ADAPTER_MODE','adapterMode')
  setUpConfigVariable(req,'ALWAYS_HTTPS','alwaysHTTPS','bool')
  setUpConfigVariable(req,'SEND_URL','sendURL','bool')
  setUpConfigVariable(req,'EXCLUDE_FILE_TYPES','excludeFileTypes','list',',')
}

export async function onClientRequest (req) {
  //Set up config.
  setUpConfig(req)

  let d = config.debug

  let protocol = req.scheme

  if(config.targetPort == 9550) {
    //Always use http for sandbox.
    protocol = 'http'
  }

  const service = new QueueFairService(req,logger)
  service.isSecure = (protocol == 'https')

  const adapter = new QueueFairAdapter(service)
  adapter.url = protocol + '://' + req.host

  if(config.targetPort != -1) {
    adapter.url += ':'+config.targetPort
  }
  adapter.url += req.url
  adapter.userAgent = req.getHeader('user-agent')[0]

  if (!await adapter.go()) {
    // Adapter says No - do not generate page.
    if(service.redirectLoc == null) {
      if(d) logger.log('QF WARNING: Queue-Fair returned stop but no redirect!');
      return req
    }
    const resp = {
      status: 302,
      headers: {
        location : service.redirectLoc,
        'x-qf-test' : 'test2',
        'set-cookie' : 'mycookie=myval'
      },
      body: '',
      addHeader : (name,value) => {
        resp.headers[name] = value
      },
      setHeader : (name,value) => {
        resp.headers[name] = value
      }
    }

    req.setVariable('PMUSER_QF_REDIRECT','true')
    service.addCookiesTo(req,true,true)
    service.setNoCache(resp,false)
    if(d) logger.log(resp);
    req.respondWith(resp.status, resp.headers,resp.body)
    return
  }

  // Page should continue.
  req.setVariable('PMUSER_QF_REDIRECT','false')
  service.addCookiesTo(req,true)
  service.setNoCache(req,true)
}

export async function onClientResponse (req, resp) {
  let d = config.debug
  logger.log('Responding')

  if(d) {
    logger.log('RESP',JSON.stringify(resp))
    logger.log('RESPH',JSON.stringify(resp.headers))
  }

  if(req.getVariable('PMUSER_QF_REDIRECT') == 'true') {
    //Queue-Fair generated response.
    let varVal = req.getVariable('PMUSER_QF_REDVAR')
    if(varVal) {
      let bits = varVal.split('|||')
      for(let i in bits) {
        logger.log('+C',bits[i])
        resp.addHeader('set-cookie',bits[i])
      }
    }
  } else {
  //Not Queue-Fair generated response.  Headers will be available.
    if(req.getHeader('x-qf-cookie')) {
        //Adds cookies.
      let headers = req.getHeader('x-qf-cookie')
      logger.log(JSON.stringify(headers))
      for(var c in headers) {
        resp.addHeader('set-cookie',headers[c])
      }
    }
  }

  if(req.getHeader('x-qf-cache') || req.getVariable('PMUSER_QF_REDIRECT') == 'true') {
    //Overrides cache-control if set by Queue-Fair.
    resp.setHeader('cache-control','no-store,no-cache,max-age=0')
  }

  if(d) {
    logger.log('QF2 RET '+JSON.stringify(resp))
  }

  return resp
}

class QueueFairService {
  req
  cookies = null
  addedCookies = null
  doneNoCache = false
  redirectLoc = null
  isSecure = false
  logger = null

  /**
   * @param {Object} req a CloudFront request
   */
  constructor(req, logger) {
    this.req= req
    this.logger = logger
  }

  log(what) {
    this.logger.log(what)
  }

  parseCookies() {
    this.cookies = []
    let reqCookies = this.req.getHeader('cookie')
    if(!reqCookies || reqCookies.length < 1) {
      return
    }
    reqCookies = reqCookies[0]
    reqCookies.split(';').forEach((c) => {
      if (c) {
        let i = c.indexOf('=')
        try {
          let key = c.substring(0,i).trim()
          let value = c.substring(i+1).trim()
          this.cookies[key] = value
        } catch (error) {
                  //Do nothing.
        }
      }
    })
  }

  /**
   * @param {string} cname the name of the cookie.
   * @return {string} the cookie value, or null if not found.
   */
  getCookie(cname) {
    if(this.cookies == null) {
      this.parseCookies()
    }
    if(typeof this.cookies[cname] !== 'undefined') {
      return this.cookies[cname]
    }
    return null
  }

  /**
   * @param {string} cname the full name of the cookie.
   * @param {string} value the value to store.
   * @param {string} lifetimeSeconds how long the cookie persists
   * @param {string} path the cookie path
   * @param {string} cookieDomain optional cookie domain.
   */
  setCookie(cname, value, lifetimeSeconds, path, cookieDomain) {
    this.noCache()
    if(this.addedCookies == null) {
      this.addedCookies = []
    }

    var v = value+';Max-Age='+lifetimeSeconds

    let date=new Date()
    date.setTime(date.getTime()+lifetimeSeconds*1000)
    v += ';Expires='+date.toUTCString()
    if(cookieDomain != null && cookieDomain != '') {
      v+=';Domain='+cookieDomain
    }
    v+=';Path='+path
    this.addedCookies[cname] = v
  }

  /**
   * Sets no-cache headers if needed.
   */
  noCache() {
    if (this.doneNoCache) {
      return
    }
    this.doneNoCache=true
  }

  /**
   * @param {string} loc where to send the visitor. 302 redirect.
   */
  redirect(loc) {
    this.noCache()
    this.redirectLoc = loc
  }

  /**
   * @return {string} the IP address of the visitor
   */
  remoteAddr() {
    return this.req.getVariable('PMUSER_QF_VISITOR_IP')
  }

  /**
   * @param {Object} obj the JSON object to which to add the cookies.
   * @param {boolean} save whether to save the values to be added later, or set them directly with set-cookie header.
   */
  addCookiesTo(obj, save, isRedirect = false) {
    if(this.addedCookies == null) {
      logger.log('NoC')
      return
    }

    let arr = []

    let headerName = save ? 'x-qf-cookie' : 'set-cookie'

    let varVal = ''

    for(var key in this.addedCookies) {
      var val = this.addedCookies[key]
      var headerVal = key+'='+val+(this.isSecure ? ';Secure;SameSite=None' : '')
      logger.log('+C '+headerName+':'+headerVal)
      if(isRedirect) {
        if(varVal) {
          varVal+='|||'
        }
        varVal+=headerVal
      } else {
        obj.addHeader(headerName,headerVal)
      }
    }
    if(isRedirect) {
      obj.setVariable('PMUSER_QF_REDVAR',varVal)
    }
  }

  /**
   * @param {Object} obj the JSON object on which to set the cache-control.
   * @param {boolean} save whether to save the value to be set later, or set directly with cache-control header.
   */
  setNoCache(obj,save) {
    if(!this.doneNoCache) {
      return
    }
    if(this.d) logger.log('NC')
      let headerName = save ? 'x-qf-cache' : 'cache-control'
    obj.setHeader(headerName, 'no-store,no-cache,max-age=0')
    if(!save) {
      obj.setHeader('expires','Thu, 1 Jan 1970 00:00:00 GMT')
    }
  }
}

/** The QueueFairAdapter class */
class QueueFairAdapter {
// Passed in constructor
  service

// You must set this to the full URL of the page before running the adapter.
  url = null

// You must set this to the visitor's User Agent before running the adapter.
  userAgent = null

// Optional extra data for your Queue Page.
  extra = null

// If you have multiple custom domains for your queues use this.
  queueDomain = null

// -------------------- Internal use only -----------------
  static cookieNameBase='QueueFair-Pass-'

  d = false
  uid = null
  continuePage = true
  settings = null
  redirectLoc=null
  adapterResult=null
  adapterQueue=null
  consultingAdapter=false
  passed = []
  protocol = 'https'
  passedString = null

// For managing the getting and caching of settings.
  static memSettings = null
  static lastMemSettingsRead = -1
  static gettingSettings = false
  settingsCounter = 0
  thisIsGettingSettings = false

// For returning from promise or timing out.
  res=null
  waitingRes = null
  finished = false



/** Convenience method
* @param {Object} config configuration for the adapter.
* @param {Object} service a service encapsulating low level functions.
*/
  constructor(service) {
    this.service = service
    if (config.debug === false) {
// defaults to false.
    } else if (config.debug === true ||
      config.debug === service.remoteAddr()) {
      this.d = true
    }

  }

/** Convenience method
* @param {string} haystack
* @param {string} needle
* @return {boolean} does haystack contain needle.
*/
  includes(haystack, needle) {
    return (haystack.indexOf(needle)!=-1)
  }

/** Convenience method
* @param {string} haystack
* @param {string} needle
* @return {boolean} does haystack start with needle.
*/
  startsWith(haystack, needle) {
    return (haystack.indexOf(needle)===0)
  }

/** Convenience method
* @param {string} haystack
* @param {string} needle
* @return {boolean} does haystack end with needle.
*/
  endsWith(haystack, needle) {
    return (haystack.indexOf(needle) != -1 &&
      haystack.indexOf(needle) == haystack.length-needle.length)
  }

/** Is this request a match for the queue?
* @param {Object} queue json
* @return {boolean} whether this request matches the
* queue's Activation Rules.
*/
  isMatch(queue) {
    if (!queue || !queue.activation || !queue.activation.rules) {
      return false
    }
    return this.isMatchArray(queue.activation.rules)
  }

/** Runs through an array of rules.
* @param {Array} arr an array of rule objects.
* @return {boolean} whether the rules match.
*/
  isMatchArray(arr) {
    if (arr == null) {
      return false
    }

    let firstOp = true
    let state = false

    for (let i = 0; i < arr.length; i++) {
      const rule = arr[i]

      if (!firstOp && rule.operator != null) {
        if (rule.operator == 'And' && !state) {
          return false
        } else if (rule.operator == 'Or' && state) {
          return true
        }
      }

      const ruleMatch = this.isRuleMatch(rule)

      if (firstOp) {
        state = ruleMatch
        firstOp = false
        if (this.d) this.log('R1:' + ((ruleMatch) ? 'true' : 'false'))
      } else {
        if (this.d) {
          this.log('R' + (i+1) +
            ': ' + ((ruleMatch) ? 'true' : 'false'))
        }
        if (rule.operator == 'And') {
          state = (state && ruleMatch)
          if (!state) {
            break
          }
        } else if (rule.operator == 'Or') {
          state = (state || ruleMatch)
          if (state) {
            break
          }
        }
      }
    }

    if (this.d) this.log('Result' + ((state) ? 'true' : 'false'))
      return state
  }

/** Extract the right component for a rule.
* @param {Object} rule the rule.
* @param {string} url the requested URL.
* @return {string} the component.
*/
  extractComponent(rule, url) {
    let comp = url
    if (rule.component == 'Domain') {
      comp=comp.replace('http://', '').replace('https://', '').split(/[/?#]/)[0]
    } else if (rule.component == 'Path') {
      const domain=comp.replace('http://', '').replace('https://', '').split(/[/?#]/)[0]
      comp=comp.substring(comp.indexOf(domain)+domain.length)
      let i=0
      if (this.startsWith(comp, ':')) {
// We have a port
        i=comp.indexOf('/')
        if (i !=-1 ) {
          comp=comp.substring(i)
        } else {
          comp=''
        }
      }
      i=comp.indexOf('#')
      if (i!=-1) {
        comp=comp.substring(0, i)
      }
      i=comp.indexOf('?')
      if (i!=-1) {
        comp=comp.substring(0, i)
      }
      if (comp=='') {
        comp='/'
      }
    } else if (rule.component == 'Query') {
      const i = comp.indexOf('?')
      if (i == -1) {
        comp = ''
      } else if (comp == '?') {
        comp=''
      } else {
        comp = comp.substring(i+1)
      }
    } else if (rule.component == 'Cookie') {
      comp=this.getCookie(rule.name)
    }
    return comp
  }


/** Tests URL and cookies against a rule.
* @param {Object} rule the rule.
* @return {boolean} true if matched.
*/
  isRuleMatch(rule) {
    const comp = this.extractComponent(rule, this.url)
    return this.isRuleMatchWithValue(rule, comp)
  }


/** Test a component against a rule.
* @param {Object} rule the rule.
* @param {string} comp the component.
* @return {boolean} true if matched.
*/
  isRuleMatchWithValue(rule, comp) {
    let test=rule.value

    if (rule.caseSensitive == false) {
      comp=comp.toLowerCase()
      test=test.toLowerCase()
    }
    if (this.d) this.log('T'+rule.component+' '+test+' vs '+comp)

      let ret=false

    if (rule.match=='Equal' && comp == test) {
      ret=true
    } else if (rule.match=='Contain' && comp!==null &&
      this.includes(comp, test)) {
      ret=true
    } else if (rule.match=='Exist') {
      if (typeof comp == 'undefined' || comp===null || ''===comp) {
        ret=false
      } else {
        ret=true
      }
    } else if (rule.match == 'RegExp') {
      if(typeof comp == 'undefined' || comp === null) {
        comp = ''
      }
      var r = new RegExp(test)
      ret = r.test(comp)
    }

    if (rule.negate) {
      ret=!ret
    }
    return ret
  }

/** What to do if a queue match is found.
* @param {Object} queue json.
* @return {boolean} whether further queues should be checked now.
*/
  async onMatch(queue) {
    if (await this.isPassed(queue)) {
      if (this.d) this.log('Passed '+queue.name);

      if (this.extra == 'CLEAR') {
        const val=this.getCookie(QueueFairAdapter.cookieNameBase+queue.name)
        if (this.d) this.log('Clear '+val);
        if (''!==val) {
          this.setCookie(queue.name, val, 20, queue.cookieDomain)
        } else {
          return true
        }
      } else {
        return true
      }
    }
    if (this.d) this.log('A '+queue.displayName);
    this.consultAdapter(queue)
    return false
  }

/** Checks if a queue has been passed already.
* @param {Object} queue json
* @return {boolean} true if passed.
*/
  async isPassed(queue) {
    if (this.passed[queue.name]) {
      if (this.d) this.log('Q '+queue.name+' passed');
      return true
    }
    const queueCookie=this.getCookie(QueueFairAdapter.cookieNameBase +
      queue.name)
    if (!queueCookie || queueCookie==='') {
      if (this.d) this.log('NC '+queue.name);
      return false
    }
    if (!this.includes(queueCookie, queue.name)) {
      if (this.d) this.log('InvC '+queueCookie+' '+queue.name);
      return false
    }

    if (!await this.validateCookieWithQueue(queue, queueCookie)) {
      if (this.d) this.log('FailC ' + queueCookie);

      this.setCookie(queue.name, '', 0, queue.cookieDomain)
      return false
    }

    if (this.d) this.log('OKC '+queue.name+' '+queueCookie);
    return true
  }

/** Creates a SHA256 HMAC hash.  MODIFIED from node.js adapter.
* @param {string} secret the secret to use.
* @param {string} message the message to sign.
* @return {string} a hash.
*/
  async createHash(secret, message) {
    var key
    if(compiledSecrets[secret]) {
      key = compiledSecrets[secret]
    } else {
      const secretKeyData = encoder.encode(secret)
      key = await crypto.subtle.importKey('raw',secretKeyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,['sign'])
      compiledSecrets[secret] =  key
    }

    var mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
    mac = [...new Uint8Array(mac)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('')
    return mac
  }

/** Processes a User-Agent for use with signature.
* @param {string} parameter the string to process.
* @return {string} a processed string.
*/
  processIdentifier(parameter) {
    if (parameter == null) {
      return null
    }
    const i = parameter.indexOf('[')
    if (i == -1) {
      return parameter
    }

    if (i < 20) {
      return parameter
    }
    return parameter.substring(0, i)
  }


/** Called to validate a cookie.  May be called externally
* (Hybrid Security Model).  MODIFIED async.
* @param {Object} queue json
* @param {string} cookie the cookie value to validate
* @return {boolean} whether it's valid
*/
  async validateCookieWithQueue(queue, cookie) {
    return await this.validateCookie(queue.secret,
      queue.passedLifetimeMinutes, cookie)
  }


/** Called to validate a cookie.  May be called externally
* (Hybrid Security Model).  MODIFIED async
* @param {string} secret the queue secret.
* @param {number} passedLifetimeMinutes the maximum allowed
* lifetime in minutes.
* @param {string} cookie the cookie value to validate
* @return {boolean} whether it's valid
*/
  async validateCookie(secret, passedLifetimeMinutes, cookie) {
    if (this.d) this.log('Validating cookie ' + cookie);

    if (cookie == null || ''==cookie) {
      return false
    }
    try {
      const parsed = this.strToPairs(cookie)
      if (parsed['qfh'] == null) {
        return false
      }

      const hash = parsed['qfh']

      const hpos = cookie.lastIndexOf('qfh=')
      const check = cookie.substring(0, hpos)

      const checkHash = await this.createHash(secret,
        this.processIdentifier(this.userAgent)+check)

      if (hash != checkHash) {
        if (this.d) this.log('BadHash ' + hash + ' ' + checkHash);
        return false
      }

      let tspos = parsed['qfts']

      tspos = parseInt(tspos)

      if (!Number.isInteger(tspos)) {
        if (this.d) this.log('BadTS ' + tspos);
        return false
      }

      if (tspos < this.time() - (passedLifetimeMinutes * 60)) {
        if (this.d) {
          this.log('OldTS ' +
            (this.time() - tspos))
        }
        return false
      }
      if (this.d) this.log('OKC');
      return true
    } catch (err) {
      if (this.d) this.log('FailC Err '+err);
    }
    return false
  }

/** Parses a query string into an array of key-value pairs.
* @param {string} str the query string.
* @return {Array} the array of pairs.
*/
  strToPairs(str) {
    const q = []

    const vars = str.split('&')

    for (let i = 0; i < vars.length; i++) {
      const pair = vars[i].split('=')
      if (pair.length > 1) {
        q[pair[0]] = decodeURIComponent(pair[1])
      }
    }
    return q
  }

/** Convenience method
* @return {number} epoch time in seconds.
*/
  time() {
    return Date.now()/1000
  }

/** Checks if a Passed String is valid.  MODIFIED async
* @param {Object} queue json
* @return {boolean} whether it's valid or not.
*/
  async validateQuery(queue) {
    try {
      const i = this.url.indexOf('?')
      if (i == -1) {
        return false
      }

      let str = this.url.substring(i)
      if ('?' == str) {
        return false
      }

      str = str.substring(1)
      const hpos = str.lastIndexOf('qfh=')

      if (hpos == -1) {
        if (this.d) this.log('NoHash');
        return false
      }

      if (this.d) this.log('QV ' + str);

      const qpos = str.lastIndexOf('qfqid=')

      if (qpos === -1) {
        if (this.d) this.log('NoQID');
        return false
      }

      const q = this.strToPairs(str)

      const queryHash = q['qfh']

      if (!queryHash) {
        if (this.d) this.log('MalHash');
        return false
      }

// const queryQID = q['qfqid']
      let queryTS = q['qfts']
// const queryAccount = q['qfa']
// const queryQueue = q['qfq']
// const queryPassType = q['qfpt']

      if (queryTS == null) {
        if (this.d) this.log('NoTS');
        return false
      }

      queryTS = parseInt(queryTS)

      if (!Number.isInteger(queryTS)) {
        if (this.d) this.log('Non#TS '+queryTS);
        return false
      }

      if (queryTS > this.time() + config.queryTimeLimitSeconds) {
        if (this.d) this.log('LateTS ' + queryTS + ' ' + this.time());
        return false
      }

      if (queryTS < this.time() - config.queryTimeLimitSeconds) {
        if (this.d) this.log('EarlyTS ' + queryTS + ' ' + this.time());
        return false
      }

      const check = str.substring(qpos, hpos)

      const checkHash = await this.createHash(queue.secret,
        this.processIdentifier(this.userAgent) + check)
      if (checkHash != queryHash) {
        if (this.d) this.log('FailHash '+checkHash);
        return false
      }

      return true
    } catch (err) {
      if (this.d) this.log('QV Err '+err);
      return false
    }
  }

/** Called to set the UID from a cookie if present. */
  setUIDFromCookie() {
    const cookieBase = 'QueueFair-Store-' + config.account

    const uidCookie = this.getCookie(cookieBase)
    if (uidCookie == '') {
      return
    }

    let i = uidCookie.indexOf(':')
    if (i == -1) {
      i = uidCookie.indexOf('=')
    }

    if (i == -1) {
      if (this.d) this.log('UIDNoSep ' + uidCookie);
      this.uid = uidCookie
      return
    }

    this.uid = uidCookie.substring(i + 1)
    if (this.d) this.log('SetUID ' + this.uid);
  }

/** Gets a cookie
* @param {string} cname the name of the cookie
* @return {string} the cookie value, or '' if not found.
*/
  getCookie(cname) {
    if (cname==='' || cname===null) {
      return ''
    }
    const val = this.service.getCookie(cname)
    if (val === null) {
      return ''
    }
    return val
  }

/** Called when settings as a string have been found
* MODIFIED async
* @param {string} data the settings as a json object
*/
  async gotSettingsStr(data) {
    try {
      const json = JSON.parse(data)
      QueueFairAdapter.memSettings = json
      QueueFairAdapter.lastMemSettingsRead = Date.now()
      json.stamp = QueueFairAdapter.lastMemSettingsRead
      await this.gotSettings(QueueFairAdapter.memSettings)
    } catch (err) {
      this.releaseGetting()
      this.errorHandler(err)
    }
  }

/** Called when settings have been found. MODIFIED async
* @param {Object} json the settings as a json object
*/
  async gotSettings(json) {
    this.releaseGetting()
    this.settings=json
    try {
      await this.checkQueryString()
      if (!this.continuePage) {
        return
      }
      await this.parseSettings()
    } catch (err) {
      this.errorHandler(err)
    }
  }

/** Parses the settings to see if we have a match,
* and act upon any match found.  MODIFIED async */
  async parseSettings() {
    try {
      if (!this.settings) {
        if (this.d) this.log('ERROR: NoSettings');
        return
      }
      if(this.isExclude()) {
        if (this.d) this.log('ExclURL');
        return
      }
      const queues=this.settings.queues
      if (!queues || !queues[0]) {
        if (this.d) this.log('NoQueues');
        return
      }
      this.parsing=true
      for (let i=0; i<queues.length; i++) {
        try {
          const queue=queues[i]
          if (this.passed[queue.name]) {
            if (this.d) {
              this.log('Passed ' + queue.displayName +
                ' ' + this.passed[queue.name])
            }
            continue
          }
          if (this.d) this.log('Check '+queue.displayName);
          if (this.isMatch(queue)) {
            if (this.d) this.log('Match '+queue.displayName);
            if (!await this.onMatch(queue)) {
              if (this.consultingAdapter) {
                return
              }
              if (!this.continuePage) {
                return
              }
              if (this.d) {
                this.log('MatchUnpassed ' +
                  queue.displayName)
              }
              if (config.adapterMode == 'simple') {
                return
              } else {
                continue
              }
            }

            if (!this.continuePage) {
              return
            }
// Passed
            this.passed[queue.name] = true
          } else {
            if (this.d) this.log('NotMatch '+queue.displayName);
          }
        } catch (err) {
          this.errorHandler(err)
        }
      }
      if (this.d) this.log('AllChecked');
      this.parsing=false
    } catch (err) {
      this.errorHandler(err)
    } finally {
      if (!this.consultingAdapter) {
        this.finish()
      }
    }
  }

/** Is this an excluded file type? */
  isExclude() {
    if(typeof config.excludeFileTypes === 'undefined' ||
      config.excludeFileTypes == null ||
      config.excludeFileTypes.length == 0)
      return false

    let saveDebug = this.d
    this.d = false
    const rule = {
      component: 'Path',
      match: 'Contain',
      value: 'NOMATCH',
      caseSensitive: true,
    }

    const comp = this.extractComponent(rule, this.url)

    for(var i = 0; i < config.excludeFileTypes.length; i++) {
      rule.value = '.'+config.excludeFileTypes[i]
      if(this.isRuleMatchWithValue(rule, comp)) {
        this.d = saveDebug
        if (this.d) this.log('Excl');
        return true
      }
    }
    this.d=saveDebug
    return false
  }

/** Launches a call to the Adapter Servers
* @param {Object} queue json
*/
  consultAdapter(queue) {
    if (this.d) {
      this.log('Ad ' + queue.name)
    }

    this.adapterQueue = queue
    let adapterMode = 'safe'

    if (queue.adapterMode != null) {
      adapterMode = queue.adapterMode
    } else if (config.adapterMode != null) {
      adapterMode = config.adapterMode
    }

    if (this.d) this.log('AdMode ' + adapterMode);

    if ('safe' == adapterMode) {
      let url = this.protocol + '://akamai.queue-fair.net/'
      + config.account + '/adapter/'
      + queue.name + '?qfa='
      + config.account

      url += '&ipaddress=' + encodeURIComponent(this.service.remoteAddr())
      if (this.uid != null) {
        url += '&uid=' + this.uid
      }

      url += '&identifier='
      url += encodeURIComponent(this.processIdentifier(this.userAgent))

      if(config.sendURL) {
        url+= '&url='
        url+= encodeURIComponent(this.url)
      }

      if (this.d) this.log('AdURL ' + url);
      this.consultingAdapter = true

//Does not require await as result unused.
      this.loadURL(url, (data) => this.gotAdapterStr(data))
      return
    }

// simple mode.
    let encTarget = this.makeTarget()
    if (this.d) this.log('T '+encTarget);
    let url = this.protocol + '://' + queue.queueServer + '/' + queue.name + '?target=' + encTarget

    url = this.appendVariant(queue, url)
    url = this.appendExtra(queue, url)
    if (this.d) this.log('AdRed ' + url);
    this.redirectLoc = url
    this.redirect()
  }

  makeTarget() {
    if(!config.alwaysHTTPS || !this.url.startsWith('http://')) {
      return encodeURIComponent(this.url)
    }

    return encodeURIComponent('https://'+this.url.substring('http://'.length))
  }

/** appends ? or & appropriately.
* @param {string} redirectLoc the URL to redirect.
* @return {string} the redirect location.
*/
  appendQueryOrAmp(redirectLoc) {
    if (redirectLoc.indexOf('?') != -1) {
      redirectLoc+='&'
    } else {
      redirectLoc+='?'
    }
    return redirectLoc
  }

/** Finds and appends any variant to the redirect location
* @param {Object} queue json
* @param {string} redirectLoc the URL to redirect.
* @return {string} the location with variant appended if found.
*/
  appendVariant(queue, redirectLoc) {
    const variant=this.getVariant(queue)
    if (variant === null) {
      if (this.d) this.log('NoVariant');
      return redirectLoc
    }
    if (this.d) this.log('Variant '+variant);
    redirectLoc=this.appendQueryOrAmp(redirectLoc)
    redirectLoc+='qfv='+encodeURIComponent(variant)
    return redirectLoc
  }

/** appends any Extra data to the redirect location
* @param {Object} queue json
* @param {string} redirectLoc the URL to redirect.
* @return {string} the location with extra appended.
*/
  appendExtra(queue, redirectLoc) {
    if (this.extra===null || this.extra==='') {
      return redirectLoc
    }
    redirectLoc=this.appendQueryOrAmp(redirectLoc)
    redirectLoc+='qfx='+encodeURIComponent(this.extra)
    return redirectLoc
  }

/** Looks through the rules to see if a variant matches.
* @param {Object} queue the queue json
* @return {string} the name of the variant, or null if none match.
*/
  getVariant(queue) {
    if (this.d) this.log('GetVariants '+queue.name);
    if (!queue.activation) {
      return null
    }
    const variantRules=queue.activation.variantRules
    if (!variantRules) {
      return null
    }
    if (this.d) this.log('GotVarRules');
    for (let i=0; i<variantRules.length; i++) {
      const variant=variantRules[i]
      const variantName=variant.variant
      const rules=variant.rules
      const ret = this.isMatchArray(rules)
      if (this.d) this.log('MatchVariant '+variantName+' '+ret);
      if (ret) {
        return variantName
      }
    }
    return null
  }

/** Called in 'safe' mode when an adapter call has returned content
* @param {string} data the content.
* */
  async gotAdapterStr(data) {
    this.consultingAdapter=false
    try {
      this.adapterResult = JSON.parse(data)
      await this.gotAdapter()
    } catch (err) {
      this.errorHandler(err)
    }
  }

/** Called in 'safe' mode when an adapter call has returned json */
  async gotAdapter() {
    try {
      if (this.d) this.log('Rec ' + JSON.stringify(this.adapterResult));

      if (!this.adapterResult) {
        if (this.d) this.log('ERROR: NoAdResult');
        return
      }

      if (this.adapterResult.uid != null) {
        if (this.uid != null && this.uid != this.adapterResult.uid) {
          this.log('BadUID!!!')
        } else {
          this.uid = this.adapterResult.uid
          this.service.setCookie('QueueFair-Store-' +
            config.account, 'u:' +
            this.uid, this.adapterResult.cookieSeconds,
            '/', this.adapterQueue.cookieDomain)
        }
      }

      if (!this.adapterResult.action) {
        if (this.d) this.log('ERROR: NoAdAction');
      }

      if (this.adapterResult.action=='SendToQueue') {
        if (this.d) this.log('SendToQueue');

        let queryParams=''
        const winLoc = this.url
        if (this.adapterQueue.dynamicTarget != 'disabled') {
          queryParams+='target='
          queryParams+=this.makeTarget()
        }
        if (this.uid != null) {
          if (queryParams != '') {
            queryParams += '&'
          }
          queryParams += 'qfuid=' + this.uid
        }

        let redirectLoc = this.adapterResult.location

        if(this.queueDomain) {
          let qd = this.queueDomain
          if (this.d) this.log('QDomain '+qd+' on '+redirectLoc);
          let i = redirectLoc.indexOf('//')
          if(i!=-1) {
            i+=2
            let colPos = redirectLoc.indexOf(':',i)
            let slashPos = redirectLoc.indexOf('/',i)
            if(colPos==-1) {
//no colon
              if(slashPos==-1) {
//https://some.domain
                redirectLoc= redirectLoc.substring(0,i)+qd
              } else {
//https://some.domain/path
                redirectLoc= redirectLoc.substring(0,i)+qd+redirectLoc.substring(slashPos)
              }
            } else {
//has a colon
              if(slashPos == -1) {
//colon no slash
//https://some.domain:8080
                redirectLoc= redirectLoc.substring(0,i)+qd+redirectLoc.substring(colPos)
              } else if(colPos < slashPos) {
//https://some.domain:8080/path
                redirectLoc= redirectLoc.substring(0,i)+qd+redirectLoc.substring(colPos)
              } else {
//https://some.domain/path?param=:
                redirectLoc= redirectLoc.substring(0,i)+qd+redirectLoc.substring(slashPos)
              }
            }
          }
          if (this.d) this.log('QDomain red '+redirectLoc);
        }

        if (queryParams!=='') {
          redirectLoc=redirectLoc+'?'+queryParams
        }
        redirectLoc=this.appendVariant(this.adapterQueue, redirectLoc)
        redirectLoc=this.appendExtra(this.adapterQueue, redirectLoc)

        if (this.d) this.log('Red '+redirectLoc);
        this.redirectLoc=redirectLoc
        this.redirect()
        return
      }
      if (this.adapterResult.action=='CLEAR') {
        if (this.d) this.log('CLEAR '+this.adapterResult.queue);
        this.passed[this.adapterResult.queue]=true
        if (this.parsing) {
          await this.parseSettings()
        }
        return
      }

// SafeGuard etc
      this.setCookie(this.adapterResult.queue,
        this.adapterResult.validation,
        this.adapterQueue.passedLifetimeMinutes*60,
        this.adapterQueue.cookieDomain)

      if (this.d) this.log('Passed ' + this.adapterResult.queue);

      this.passed[this.adapterResult.queue]=true

      if (this.parsing) {
        await this.parseSettings()
      }
    } catch (err) {
      if (this.d) this.log('QF Error '+err.message);
      this.errorHandler(err)
    }
  }

/** Redirects the browser.
*/
  redirect() {
// Either Queue-Fair redirects, or the page continues.
    this.continuePage = false
    this.service.redirect(this.redirectLoc)
    this.finish()
  }

/** Sets a Passed Cookie
*
* @param {string} queueName the name of the queue.
* @param {string} value the Passed String to store.
* @param {number} lifetimeSeconds how long the cookie should persist.
* @param {string} cookieDomain optional domain - otherwise
* the page's domain is used.
*/
  setCookie(queueName, value, lifetimeSeconds, cookieDomain) {
    if (this.d) {
      this.log('SC ' +
        queueName + ',' + value + ',' + cookieDomain)
    }

    const cookieName=QueueFairAdapter.cookieNameBase+queueName

    this.service.setCookie(cookieName, value,
      lifetimeSeconds, '/', cookieDomain)

    if (lifetimeSeconds <= 0) {
      return
    }

    this.passed[queueName] = true
    if (config.stripPassedString) {
      const loc = this.url
      const pos = loc.indexOf('qfqid=')
      if (pos == -1) {
        return
      }
      if (this.d) this.log('Strip!');
      this.redirectLoc = loc.substring(0, pos - 1)
      this.redirect()
    }
  }

/** Get the content of a URL and call next as a callback.
* MODIFIED from node.js - doRequest() not needed and deleted.
*
* @param {string} urlStr the url as a string
* @param {function} next the callback
*/
  async loadURL(urlStr, next) {
    if (this.d) this.log('Load '+urlStr);
    try {
      let options = {timeout : config.queryTimeLimitSeconds * 1000}

      let htmlResponse = await httpRequest(urlStr, options)
      if(!htmlResponse.ok) {
        throw new Error('LoadURL Not OK '+urlStr)
      }

      let bodyStr = await htmlResponse.text()

      next(bodyStr)
    } catch (err) {
      this.releaseGetting()
      this.errorHandler(err)
      this.finish()
    }
  }

/** Unsets flags that indicate an http request is in progress.
*/
  releaseGetting() {
    if (this.thisIsGettingSettings) {
      this.thisIsGettingSettings = false
      QueueFairAdapter.gettingSettings = false
    }
    while(true) {
      let other = waiting.pop()
      if(!other) {
        break
      }
      if(other.finished) {
        continue
      }
      if(!other.waitingRes) {
        continue
      }
      let waitingRes = other.waitingRes
      other.waitingRes = null
      waitingRes(QueueFairAdapter.memSettings)
    }
    if (this.consultingAdapter) {
      this.consultingAdapter = false
    }
  }

/** Convenience logging method
*
* @param {Object} what the thing to log.
*/
  log(what) {
    this.service.log(what)
  }

/** Wait for another request to finish downloading settings */
  waitForSettings() {
    let ad = this
    return new Promise((res) => {
      ad.waitingRes = res
      waiting.push(ad)
    })
  }

/** Gets settings from the memory cache or downloads a fresh
* copy. Only one request at a time may attempt the download.
* Waits if already being do
* */
  async loadSettings() {
    if (QueueFairAdapter.memSettings != null &&
      QueueFairAdapter.lastMemSettingsRead != -1 &&
      Date.now() - QueueFairAdapter.lastMemSettingsRead <
      config.settingsCacheLifetimeMinutes * 60 *1000)
    {

    // Old settings are good.
      if (this.d) this.log('MS');
      await this.gotSettings(QueueFairAdapter.memSettings)
      return
    }

    if (QueueFairAdapter.gettingSettings  && waiting.length < 100) {
      if (this.d) this.log('WaitingS');
      let data = await this.waitForSettings()
      try {
        await this.gotSettings(data)
      } catch (err) {
        this.releaseGetting()
        this.errorHandler(err)
      }
      return
    }

    if (this.d) this.log('DS');
    QueueFairAdapter.gettingSettings = true
    this.thisIsGettingSettings = true

    let settingsURL = 'https://akamai.queue-fair.net/files/' +
    config.account + '/' +
    config.accountSecret +
    '/queue-fair-settings.json'

    this.loadURL(settingsURL, (data) => this.gotSettingsStr(data))
  }

/** Retrieve the query string from the url.
*
* @return {string} the query string.
* */
  getQueryString() {
    if (this.url == null) {
      return ''
    }
    const i = this.url.indexOf('?')
    if (i==-1) {
      return ''
    }
    return this.url.substring(i)
  }

/** Checks if a Passed String is present and sets the Passed Cookie.
*/
  async checkQueryString() {
    const urlParams = this.url
    if (this.d) this.log('CQS ' + urlParams);
    const q = urlParams.lastIndexOf('qfqid=')
    if (q === -1) {
      return
    }
    if (this.d) this.log('Found');

    let i = urlParams.lastIndexOf('qfq=')
    if (i == -1) {
      return
    }

    const j = urlParams.indexOf('&', i)
    const subStart = i + 'qfq='.length
    const queueName = urlParams.substring(subStart, j)

    if (this.d) this.log('Q ' + queueName);
    const lim = this.settings.queues.length

    for (i = 0; i < lim; i++) {
      const queue = this.settings.queues[i]
      if (queue.name != queueName) {
        continue
      }

      //Found queue for querystring ' + queueName
      if (this.d) this.log('FQ' + queueName);

      let value = '' + urlParams
      value = value.substring(value.lastIndexOf('qfqid'))

      if (!await this.validateQuery(queue)) {
// This can happen if it's a stale query string too
// so check for valid cookie.
        const queueCookie = this.getCookie(QueueFairAdapter.cookieNameBase + queueName)
        if ('' != queueCookie) {
          if (this.d) {
            //'Query validation failed but we have cookie ' + queueCookie
            this.log('QV Fail - C ' + queueCookie);
          }

          if (await this.validateCookieWithQueue(queue, queueCookie)) {
            //...and the cookie is valid. That\'s fine.
            if (this.d) this.log('CValid');
            return
          }
          if (this.d) this.log('QV and CV FAIL!');
        } else {
          if (this.d) {
            //'Bad queueCookie for ' + queueName + ' ' + queueCookie
            this.log('Bad C')
          }
        }

        let target = this.url
        const i = target.indexOf('qfqid=')
        if(i != -1) {
          target = target.substring(0,i)
        }
        const loc = this.protocol + '://' + queue.queueServer + '/' +
        queue.name + '?qfError=InvalidQuery&target='+encodeURIComponent(target)

        if (this.d) this.log('-> Error Page');

        this.redirectLoc = loc
        this.redirect()
        return
      }

      if (this.d) {
        this.log('QV OK')
      }
      this.passedString = value

      this.setCookie(queueName, value,
        queue.passedLifetimeMinutes * 60,
        queue.cookieDomain)

      if (!this.continuePage) {
        return
      }

      if (this.d) this.log(queueName + ' Passed');

      this.passed[queueName] = true
    }
  }


/** Called if an irrecoverable error occurs.
*
* @param {Object} err an error
* */
  errorHandler(err) {
    this.releaseGetting()
    this.log('QF Error')
    this.log(err)
    this.finish()
  }

/** run some initial setup and checks.
*
* @return {boolean} whether the adapter should proceed.
* */
  setUp() {
    if (this.startsWith(config.account, 'DELETE')) {
      this.errorHandler('You must set your account system name in config.')
      return false
    }
    if (this.startsWith(config.accountSecret, 'DELETE')) {
      this.errorHandler('You must set your account secret in config.')
      return false
    }
    if (this.url == null) {
      this.errorHandler('You must set adapter.url before running the Adapter.')
      return false
    }
    if (this.userAgent == null) {
      this.errorHandler('You must set adapter.userAgent ' +
        'before running the Adapter.')
      return false
    }
    if (!this.startsWith(this.url, 'https')) {
      this.protocol = 'http'
    }
    return true
  }

/** Start by retrieving settngs. MODIFIED async */
  async goGetSettings() {
    try {
      if (!this.setUp()) {
        return
      }

      if (config.readTimeout < 1) {
        config.readTimeout = 1
      }
      this.setUIDFromCookie()
      await this.loadSettings()
    } catch (err) {
      this.releaseGetting()
      this.errorHandler(err)
    }
  }

/** The main entry point
*
* @return {Object} a promise.
* */
  go() {
    return new Promise((res, rejPromise) => {
      this.res = res
      this.goGetSettings()
    })
  }

/** Called when it's finished to fill the promise */
  finish() {
    if (this.finished) {
      return
    }
    this.finished=true
    if (this.res != null) {
      this.res(this.continuePage)
    }
  }
}
