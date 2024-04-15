---
## Queue-Fair Free Akamai Virtual Waiting Room Network-Edge Adapter README & Installation Guide

Queue-Fair can be added to any web server easily in minutes, and is a great way to get a free Akamai virtual waiting room, as Queue-Fair offers its own Free Tier, and the Adapter only users Akamai free plan features.  You will need a Queue-Fair account - please visit https://queue-fair.com/free-trial if you don't already have one.  You should also have received our Technical Guide.  To find out more about how a Virtual Waiting Room protects your site or app from traffic spikes, see https://queue-fair.com/virtual-waiting-room

## Client-Side JavaScript Adapter

Most of our customers prefer to use the Client-Side JavaScript Adapter, which is suitable for all sites that wish solely to protect against overload.

To add the Queue-Fair Client-Side JavaScript Adapter to your web server, you don't need the files included in this distribution.

Instead, add the following tag to the `<head>` section of your pages:
 
```
<script data-queue-fair-client="CLIENT_NAME" src="https://files.queue-fair.net/queue-fair-adapter.js"></script>`
```

Replace CLIENT_NAME with the account system name visibile on the Account -> Your Account page of the Queue-Fair Portal

You shoud now see the Adapter tag when you perform View Source after refreshing your pages.

And you're done!  Your queues and activation rules can now be configured in the Queue-Fair Portal.

## Akamai Network-Edge Adapter
Using the Akamai Adapter means that your Akamai implementation communicates directly with the Queue-Fair Queue Server Cluster, rather than your visitors' browsers or your origin server.

This can introduce a dependency between our systems, which is why most customers prefer the Client-Side Adapter.  See Section 10 of the Technical Guide for help regarding which integration method is most suitable for you.

The Akamai Adapter is a small JavaSrcript library that will run as an EdgeWorker when visitors make requests served by Akamai.  It is implemented as a single JavaScript file for ease of installation - you can just copy and paste it into the Akamai worker editor (see below for step-by-step instructions).  Or, you can upload the latest '.tar.gz' release file, as it includes a `bundle.json` and `main.js`.

It is adapted from our cross-platform Node Adapter - there are changes to the QueueFairService class, which is the one that usually contains platform-specific code, and also some small changes to the QueueFairAdapter class to use the Akamai native httpRequest and crypto functions.  Unlike our https://github.com/queue-fair/node adapter, all the classes are defined in the one `main.js` file, and the QueueFairConfig class is replaced with a constant object.  It all works the same way.

The Adapter periodically checks to see if you have changed your Queue-Fair settings in the Portal, and caches the result in memory, but other than that if the visitor is requesting a page that does not match any queue's Activation Rules, it does nothing, and Akamai will return a (possibly cached) copy of the page from your origin server(s).

If a visitor requests a page that DOES match any queue's Activation Rules, the Adapter consults the Queue-Fair Queue Servers to make a determination whether that particular visitor should be queued (Safe Mode, recommended) or sends the visitor to be counted at the Queue-Fair Queue Servers (Simple Mode).  If so, the visitor is sent to our Queue Servers and execution and generation of the page for that HTTP request for that visitor will cease, and your origin server will not receive a request.  If the Adapter determines that the visitor should not be queued, it sets a cookie to indicate that the visitor has been processed and Akamai will return a page from its cache or contact your origin server as normal.

Thus the Akamai Adapter prevents visitors from skipping the queue by disabling the Client-Side JavaScript Adapter, and also eliminates load on your origin server when things get busy.

These instructions assume you already have a Akamai account with an ION Property with an origin already set up.  If that's not the case, you should set one up before proceeding and test that it is working with both https and http requests.  The instructions below also assume you have opted in for the EdgeWorkers Dynamic Compute trial or contract in Akamai Marketplace.

Akamai includes up to 1 million free EdgeWorker requests per month at the time of writing, so you may well find yourself never paying anything.  Even if you have more than a million page hits per month, the additional cost from Akamai is not substantial.

Here's how to add Queue-Fair to your Akamai implementation. 

**1.** **Tell us** you wish to use the Queue-Fair Akamai Adapter - we need to apply some configuration at our end before you can use it, otherwise *it won't work*.

**2.** Go to Control Centre, and in the three-line menu at the top left, select **CDN -> EdgeWorkers**, then the orange **Create EdgeWorker Id** button.  In the dialog that pops up, name it `queue-fair-adapter`.  Select a group from the pulldown,  and the resource group should be `Dynamic Compute`.  You can enter a description if you like, then the orange **Create EdgeWorker Id** button in the dialog.

**3.** Your edgeworker will be given a numeric ID shown in blue.  Click it.  Then it's the orange **Create Version** button.

**4.** You can either drag and drop the latest `.tar.gz` release of this distribution, or Open Editor, and copy-and-paste the `main.js` file from this distribution, then the orange **Create new version** button at the bottom.  Once the version has been created, it's the orange **Activate version** button.  You would normally test your changes on Staging, but you can go straight to Production if you like.  Wait for the activation to complete - about 10 minutes.

**5.** In the three-line menu at the top left, select **CDN -> Properties**, and the ION Property on which you wish to deploy the Adapter. Find your currently Active version, and in the three dots menu in the Actions column, select **Edit New Version**.

**6.** In the **Property Variables section**, create three new variables, `PMUSER_QF_ACCOUNT_SYSTEM_NAME`, `PMUSER_QF_ACCOUNT_SECRET` and `PMUSER_QF_VISITOR_IP`.  There are additional variables you can create that affect the operation of the Adapter - these are described in the config object at the top of `main.js`, where you will find the names you must use for the variables.  

You **MUST** create at least the three variables described above.   All variables should have **Security Settings** set to `Hidden`.  You can leave the description blank.  

`PMUSER_QF_ACCOUNT_SYSTEM_NAME` must have an **initial value** of the **Account System Name** shown on the *Account -> Your Account* page in the Queue-Fair Portal (and NOT the system name of any Queue).  

`PMUSER_QF_ACCOUNT_SECRET` must have an **initial value** of the **Account Secret** shown on the *Account -> Your Account page* in the Queue-Fair Portal (and NOT the secret of any Queue). 

'PMUSER_QF_VISITOR_IP' **initial value** should be '0.0.0.0'

**7.** Scroll down to the **Property Configuration Settings** section and hit the **+ Rules** button.  Keep the default Blank Rule Template and name your new rule `queue-fair-adapter-rule`, then it's the orange **Insert Rule** button.

**8.** Scroll down the left tab to find your new rule, or hit Collapse All and it should appear.  Click on it.

**9.** In the panel to the right, in the **Criteria** section, hit the **+ Match** button.  To allow the Adapter to run on all the pages on your site, you want *If Path matches one of* `/*` which is recommended as then you can use Activation Rules in the Portal to deploy your queues on specific pages or groups of pages, without having to modify your Akamai configuration.  If you know you are only ever going to queue people to a certain group of URLs on your site, you can have a more restrictive path like `/myarea/*` if you prefer.

**10.** IMPORTANT: Unlike our Client-Side JavaScript Adapter, which only runs on whole page requests, the Akamai Adapter can potentially run on **any** URL on your site.  You normally only want it to run on full page requests, and not media or static assets like pngs, jpegs or css files.  

If you have static assets in a folder on your site, it's best to exclude this folder (or folders) from the EdgeWorker.  So, hit the **+ Match*** button again, and create an *If Path does not match one of* criterion.  If, for example, your static assets are all under https://mysite.com/assets, add a path `/assets/*`.  This will exclude `assets` and any subfolders from your EdgeWorker.    Similarly, if you have static files in `/images/*` or `/img/*` or `/css/*` or `/js/*` or `/vendor/*`, add them to the exclusion list. We also recommend you exclude common static file extensions, so `*.png`, `*.jpg`, `*.webp`, `*.xml`, `*.ico` etc - for a full list of the recommended additions, see the `excludedFileTypes` property of the config object at the top of `main.js`.  

Our clients usually prefer the Adapter not to run on background requests that your page JavaScript might make, so these should also be excluded, for exampe with `/api/*`.  

Lastly, and *most importantly*, if there are third party systems or your own automated processes that call URLs on your site, you normally don't want these to be queued when things get busy or you could find yourself *unable to take orders!* So, also add any paths for *Payment Gateway Webhooks* or *Callback URLs*, or any other URLs for background API calls that you never want to queue.

**11.** If you can't scroll down to the *Behaviors* section, click on the grey *Criteria* bar to collapse it - you should then see the *Behaviors* panel.  Next hit the *+ Behavior* button, and select Standard property behavior.  Start typing `Set Variable`, and select it when it appears, then it's *Insert Behavior*.  Select `PMUSER_QF_VISITOR_IP` from the dropdown.  Leave *Create Value From* set to `Expression`.  In the Expression box, copy-and-paste `{{builtin.AK_CLIENT_REAL_IP}}` if Akamai is the first service that HTTP requests from your visitors reach.  If Akamai is sitting behind something else, such that the visitor's IP address is contained in an `X-Forwarded-For` header, then it's `{{builtin.AK_CLIENT_IP}}` instead.

**12.** Hit the **+ Behavior** button again.  This time, start typing `EdgeWorkers` and click it once you can see it, and **Insert Behavior**.  From the **Identifier** pulldown select your `queue-fair-adapter` EdgeWorker.  You probably don't need mPulse reports, but you can enable them if you like.  Hit the orange **Save** button at the bottom of the page.  The EdgeWorker behavior **MUST** be below the Set Variable behavior for `PMUSER_QF_VISITOR_IP` - if they are in the wrong order, you must drag to reorder the behaviors.

**13.** Scroll up to the very top of the page, and select the **Activate** tab.  Push your new version to Staging and/or Production as you see fit.   We would normally recommend you test it on Staging first!

**14.** And that's it - your done.  It's installed!

### To test the Akamai Adapter

Use a queue that is not in use on other pages, or create a new queue for testing.

#### Testing SafeGuard
Set up an Activtion Rule to match the page you wish to test.  Hit Make Live.  Go to the Settings page for the queue.  Put it in SafeGuard mode.  Hit Make Live again.  You may need to wait five minutes for the new Activation Rules to become visible to the Adapter - it only checks for new rules once every five minutes, and there is a CDN timeout of five minutes on your settings files too.

In a new Private Browsing window, visit the page on your site that matches the Activation Rules.  

 - Verify that a cookie has been created named `QueueFair-Pass-queuename`, where queuename is the System Name of your queue
 - If the Adapter is in Safe mode (the default), also verify that a cookie has been created named QueueFair-Store-accountname, where accountname is the System Name of your account (on the Your Account page on the portal).
 - If you have set the Adapter to Simple mode in the `config` section at the top of the worker code, the `QueueFair-Store` cookie is not created.
 - Hit Refresh.  Verify that the cookie(s) have not changed their values.

#### Testing Queue
Go back to the Portal and put the queue in Demo mode on the Queue Settings page.  Hit Make Live.  Close ALL Private Browsing windows and tabs (as they share a cookie space) and open a new one.  Go to the page that matches the Activation Rules on your site.

 - Verify that you are now sent to queue.
 - When you come back to the page from the queue, verify that a new `QueueFair-Pass-queuename` cookie has been created.
 - If the Adapter is in Safe mode, also verify that the `QueueFair-Store` cookie has not changed its value.
 - Hit Refresh.  Verify that you are not queued again.  Verify that the cookies have not changed their values.

**IMPORTANT:**  Once you are sure the Akamai Adapter is working as expected, remove the Client-Side JavaScript Adapter tag from your pages if you were using it, and also remove any Server-Side Adapter code from your origin server if you had already installed it.

**IMPORTANT:**  Responses that contain a `Location:` header or a `Set-Cookie` header from the Adapter must not be cached!  You can check which cache-control headers are present using your browser's Inspector Network Tab.  The Adapter will set a `Cache-Control` header to disable browser and Akamai caching if it sets a cookie or sends a redirect - but r not override these with your own EdgeWorker code or other framework.

### For maximum security

The Akamai Adapter contains multiple checks to prevent visitors bypassing the queue, either by tampering with set cookie values or query strings, or by sharing this information with each other.  When a tamper is detected, the visitor is treated as a new visitor, and will be sent to the back of the queue if people are queuing.

 - The Akamai Adapter checks that Passed Cookies and Passed Strings presented by web browsers have been signed by our Queue-Server.  It uses the Secret visible on each queue's Settings page to do this.
 - If you change the queue Secret, this will invalidate everyone's cookies and also cause anyone in the queue to lose their place, so modify with care!
 - The Akamai Adapter also checks that Passed Strings coming from our Queue Server Cluster to your site were produced within the last 30 seconds.
 - The Akamai Adapter also checks that passed cookies were produced within the time limit set by Passed Lifetime on the queue Settings page, to prevent visitors trying to cheat by tampering with cookie expiration times or sharing cookie values.  So, the Passed Lifetime should be set to long enough for your visitors to complete their transaction, plus an allowance for those visitors that are slow, but no longer.
 - The signature also includes the visitor's USER_AGENT, to further prevent visitors from sharing cookie values.

## AND FINALLY

Remember we are here to help you! The integration process shouldn't take you more than an hour - so if you are scratching your head, ask us.  Many answers are contained in the Technical Guide too.  We're always happy to help!

