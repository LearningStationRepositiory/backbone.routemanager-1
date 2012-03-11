/* backbone.routemanager.js v0.0.0
 * Copyright 2012, Tim Branyen (@tbranyen)
 * backbone.routemanager.js may be freely distributed under the MIT license.
 */
(function(window) {

"use strict";

// 
function handleRoute(original, route) {
  var fragment;
  var filters = [];
  var routers = [];
  var router = this;

  // Detect the identiifers out of the route
  var identifiers = _.map(route.match(/:(\w+)|\*(\w+)/g), function(arg) {
    return arg.slice(1);
  });

  // Potentially IE 6-friendly
  // Get the argument names from a given function.
  function detectArgs(fun) {
    var i, arg;
    // Store ordered list of all the argument names.
    var names = [];
    // First match everything inside the function argument parens. Split the
    // arguments string into an array comma delimited.
    var args = fun.toString().match(/function\s+\(([^)]*)\)/)[1].split(", ");

    // Iterate over all arguments.
    for (i = 0; i < args.length; i++) {
      arg = args[i];

      // Ensure no inline comments are parsed.
      if (arg = arg.replace(/\/\*.*\*\//, "")) {
        // Trim the whitespace and ensure no undefineds are added.
        names.push(arg.replace(/^\s+|\s+$/g, ""));
      }
    }

    return names;
  }

  // Add to filters.
  function addFilters(name, prefix) {
    var router = routers[0];
    var allFilters = _.chain(router[name]);

    // Ensure the filters array exists.
    filters[name] = filters[name] || [];

    // Only return filters that match this route.
    allFilters.filter(function(filters, route) {
      return prefix + "/" + route === fragment;
    });

    // Hopefully this and the map operation can be refactored to work
    // with chain.
    allFilters = _.reduce(allFilters.value(), function(memo, filter) {
      return memo.concat(filter);
    }, []);

    // Change all the filter string identifiers into their respective
    // functions.
    allFilters = _.map(allFilters, function(filter) {
      var root, method;

      // Search for the method most to least specific
      _.find(routers, function(router) {
        if (_.isFunction(router[filter])) {
          root = router;

          return method = router[filter];
        }
      });

      // For now we'll just silence and not throw errors for missing
      // functions.
      if (!_.isFunction(method)) {
        method = function() {};
      }

      return [ root, method ];
    });

    // Add into the filters object array
    filters[name] = filters[name].concat(allFilters);
  }

  // Create a recursive function, to detect all before and after filters.
  function detectFilters(router) {
    // Ensure the prefix is detected correctly.
    var prefix = router.__manager__.prefix;

    // Unshift the routers onto the chain, most specific first.
    routers.unshift(router);

    // Add the before and after filters.
    addFilters("before", prefix);
    addFilters("after", prefix);

    // This router wasn't the match, recurse until found.
    if (router.routers) {
      _.each(router.routers, function(router) {
        return detectFilters(router);
      });
    }
  }

  // Replace the route function with the wrapped version
  return function() {
    var args = arguments;

    fragment = Backbone.history.fragment;

    // Params are a named object
    this.params = {};

    // Map the arguments to the names inside the params object
    _.each(identifiers, function(arg, i) {
      this.params[arg] = args[i];
    }, this);

    // Detect all the filters for this router.
    detectFilters(router);

    // Execute all the before filters
    _.each(filters.before, function(filter) {
      var newArgs = [];

      // Remap arguments to named `this.params`
      _.each(detectArgs(original), function(arg, i) {
        newArgs[i] = this.params[arg];
      }, this);
      
      filter[1].apply(filter[0], newArgs);
    }, this);

    // Call the original router
    original.apply(router, arguments);

    // Reset routers and filters after calling the before/after and route
    // callbacks
    routers = [];
    filters = [];
  };
}

// Alias the libraries from the global object
var Backbone = window.Backbone;
var _ = window._;
var $ = window.$;

var RouteManager = Backbone.Router.extend({
  // The constructor must be overridden, because this is where Backbone
  // internally binds all routes.
  constructor: function(options) {
    // Useful for nested functions
    var root = this;
    // Use for normal routes
    var routes = {};
    // Use for attached routers
    var routers = this.routers = {};
    // Router attached routes, normalized
    var normalizedRoutes = options.routes || this.routes;

    // Iterate and augment the routes hash to accept Routers
    _.each(normalizedRoutes, function(action, route) {
      var prefix, parent, router, SubRouter, originalRoute;

      prefix = options.prefix;

      // Prefix is optional, set to empty string if not passed
      if (!prefix) {
        prefix = route || "";
      }

      // Allow for optionally omitting trailing /.  Since base routes do not
      // trigger with a trailing / this is actually kind of important =)
      if (prefix[prefix.length-1] === "/") {
        prefix = prefix.slice(0, prefix.length-1);

      // If a prefix exists, add a trailing /
      } else if (prefix) {
        prefix += "/";
      }

      // SubRouter constructors need to be augmented to allow for filters, they
      // are also attached to a special property on the RouteManager for
      // easy accessibility and event binding.
      if (action.prototype instanceof Backbone.Router) {
        // Maintain a reference to the user-supplied constructor
        parent = action.prototype.constructor;

        // Extend the SubRouter to override the constructor function
        SubRouter = action.extend({
          constructor: function(options) {
            var ctor = Backbone.Router.prototype.constructor;

            // Make sure to prefix all routes
            _.each(this.routes, function(method, route) {
              delete this.routes[route];

              route = route ? prefix + "/" + route : prefix;

              // Replace the route with the override
              this.routes[route] = method;
              this[method] = handleRoute.call(this, this[method], route);
            }, this);

            return ctor.apply(this, arguments);
          }
        });

        // Initialize the Router inside the collection
        router = routers[route] = new SubRouter();
        
        // Give the router state!
        route._state = {};

        // Internal object cache for special RouteManager functionality.
        router.__manager__ = {};

        // If there is a custom constructor function provided by the user;
        // make sure to be a good samaritan.
        if (_.isFunction(parent)) {
          parent.call(router);
        }

        // Used to avoid multiple lookups for router+prefix
        router.__manager__.prefix = prefix;

        // No need to delete from this.routes, since the entire object is
        // replaced anyways.

      // If it is not a Backbone.Router, then its a normal route, assuming
      // the action and route are strings.
      } else if (_.isString(action) && _.isString(route)) {
        // Reset this here, since we don't want duplicate routes
        prefix = options.prefix ? options.prefix : "";

        // Add the route callbacks to the instance, since they are
        // currently inside the options object.
        root[action] = handleRoute.call(root, options[action], route);

        // Remove once the swap has occured.
        delete options[action];
        
        // Add route to collection of "normal" routes, ensure prefixing.
        if (route) {
          return routes[prefix + route] = action;
        }

        // If the path is "" just set to prefix, this is to comply
        // with how Backbone expects base paths to look gallery vs gallery/.
        routes[prefix] = action;
      }
    });

    // Add the manager routes.
    this.routes = routes;

    // Fall back on Backbone.js to set up the manager routes.
    return Backbone.Router.prototype.constructor.call(this);
  },

  __manager__: { prefix: "" }
},
{
  // This static method allows for global configuration of RouteManager.
  configure: function(options) { 
    var existing = Backbone.RouteManager.prototype.options;

    // Without this check the application would react strangely to a foreign
    // input.
    if (_.isObject(options)) {
      return _.extend(existing, options);
    }
  }
});

// Default configuration options; designed to be overriden.
RouteManager.prototype.options = {
  // Can be used to supply a different deferred that implements Promises/A.
  deferred: function() {
    return $.Deferred();
  }
};

Backbone.RouteManager = RouteManager;

})(this);
