/**
 * replaceScriptTag
 * expandPath
 * analyseScript
 * defineWidget
 */

'use strict';

var gutil = require('gulp-util');
var through = require('through2');
var PluginError = gutil.PluginError;
var tagFilter = require('./lib/tagFilter.js');

var pluginName = 'gulp-her-templateBuilder';

var stringRegStr = '(?:' +
  '\"(?:[^\\\\\"\\r\\n\\f]|\\\\[\\s\\S])*\"' + //match the " delimiter string
  '|' +
  '\'(?:[^\\\\\'\\r\\n\\f]|\\\\[\\s\\S])*\'' + //match the ' delimiter string
  ')';

var jscommentRegStr = '(?:' +
  '\\/\\/[^\\r\\n\\f]*' + // match the single line comment
  '|' +
  '\\/\\*[\\s\\S]+?\\*\\/' + //match the multi line comment
  ')';

var jsStringArrayRegStr = '(?:' +
  '\\[\\s*' + stringRegStr + '(?:\\s*,\\s*' + stringRegStr + ')*\\s*\\]' + //match string array
  ')';

function createError(file, err) {
  if (typeof err === 'string') {
    return new PluginError(pluginName, file.path + ': ' + err, {
      fileName: file.path,
      showStack: false
    });
  }

  var msg = err.message || err.msg || 'unspecified error';

  return new PluginError(pluginName, file.path + ': ' + msg, {
    fileName: file.path,
    lineNumber: err.line,
    stack: err.stack,
    showStack: false
  });
}

//replaceScriptTag
//eg: <script runat="server"></script> => {script}{/script}
module.exports.replaceScriptTag = function (opt) {
  var smarty_left_delimiter = her.config.get('setting.smarty.left_delimiter') || '{';
  var smarty_right_delimiter = her.config.get('setting.smarty.right_delimiter') || '}';

  function replace(file, encoding, callback) {

    if (file.isNull()) {
      return callback(null, file);
    }

    if (file.isStream()) {
      return callback(createError(file, 'Streaming not supported'));
    }

    var runAtServerReg = /(?:^|\s)runat\s*=\s*(["'])server\1/;
    var content = String(file.contents);

    content = tagFilter.filterBlock(content,
      'script', '<', '>',
      function (outter, attr, inner) {
        if (runAtServerReg.test(attr)) {
          return smarty_left_delimiter +
            'script' +
            attr.replace(runAtServerReg, '') +
            smarty_right_delimiter +
            inner +
            smarty_left_delimiter +
            '/script' +
            smarty_right_delimiter;
        } else {
          return outter;
        }
      });

    file.contents = new Buffer(content);

    callback(null, file);
  }

  return through.obj(replace);
};

// expand the relative path to the abosulte path
module.exports.expandPath = function (opt) {
  var smarty_left_delimiter = her.config.get('setting.smarty.left_delimiter') || '{';
  var smarty_right_delimiter = her.config.get('setting.smarty.right_delimiter') || '}';

  function expand(file, encoding, callback) {

    if (file.isNull()) {
      return callback(null, file);
    }

    if (file.isStream()) {
      return callback(createError(file, 'Streaming not supported'));
    }

    var content = String(file.contents);

    content = expandSmartyPathAttr(content, 'html', 'her', file);
    content = expandSmartyPathAttr(content, 'require', 'name', file);
    content = expandSmartyPathAttr(content, 'widget', 'name', file);
    content = expandScriptRequirePath(content, file);

    file.contents = new Buffer(content);

    callback(null, file);
  }

  //expand smarty template resource path
  function expandSmartyPathAttr(content, tagName, attrName, file) {
    var attrReg = new RegExp('((?:^|\\s)' +
    her.util.pregQuote(attrName) +
    '\\s*=\\s*)(([\"\']).*?\\3)', 'ig');

    content = tagFilter.filterTag(content,
      tagName, smarty_left_delimiter, smarty_right_delimiter,
      function (outter, attr) {

        attr = attr.replace(attrReg,
          function (all, preCodeHolder, valueCodeHolder) {
            var info = her.util.stringQuote(valueCodeHolder);
            var path = info.rest;
            var ret = info.quote + her.uri.getId(path, file.dirname).id + info.quote;
            return preCodeHolder + ret;
          });

        outter = smarty_left_delimiter +
        tagName + attr +
        smarty_right_delimiter;

        return outter;
      });

    return content;
  }

  //expand require、require.async、require.defer path in js
  function expandScriptRequirePath(content, file) {
    var requireRegStr = '(\\brequire(?:\\s*\\.\\s*(?:async|defer))?\\s*\\(\\s*)(' +
      stringRegStr + '|' +
      jsStringArrayRegStr + ')';

    //first match the string or comment
    var reg = new RegExp(stringRegStr + '|' +
    jscommentRegStr + '|' +
    requireRegStr, 'g');

    content = tagFilter.filterBlock(content,
      'script', smarty_left_delimiter, smarty_right_delimiter,
      function (outter, attr, inner) {

        inner = inner.replace(reg,
          function (all, requirePrefix, requireValueStr) {
            var hasBrackets = false;

            if (requirePrefix) {

              //if here has '[]' , cut it
              requireValueStr = requireValueStr.trim().replace(/(^\[|\]$)/g, function (m, v) {
                if (v) {
                  hasBrackets = true;
                }
                return '';
              });
              var info;
              var path;
              var ret;
              if (hasBrackets) { //Array
                var requireValue = requireValueStr.split(/\s*,\s*/);
                all = requirePrefix +
                '[' + requireValue.map(function (value) {
                  info = her.util.stringQuote(value);
                  path = info.rest;
                  ret = info.quote + her.uri.getId(path, file.dirname).id + info.quote;
                  return ret;
                }).join(',') + ']';
              } else { //String
                info = her.util.stringQuote(requireValueStr);
                path = info.rest;

                ret = info.quote + her.uri.getId(path, file.dirname).id + info.quote;
                all = requirePrefix + ret;
              }

            }
            return all;
          });

        return smarty_left_delimiter +
          'script' +
          attr +
          smarty_right_delimiter +
          inner +
          smarty_left_delimiter +
          '/script' +
          smarty_right_delimiter;
      });
    return content;
  }

  return through.obj(expand);
};

//analyse require、require.async、require、defer calls between {script} and {/script} and make it to the {script} dependeces
module.exports.analyseScript = function (opt) {
  var smarty_left_delimiter = her.config.get('setting.smarty.left_delimiter') || '{';
  var smarty_right_delimiter = her.config.get('setting.smarty.right_delimiter') || '}';

  function analyse(file, encoding, callback) {

    if (file.isNull()) {
      return callback(null, file);
    }

    if (file.isStream()) {
      return callback(createError(file, 'Streaming not supported'));
    }

    var content = String(file.contents);

    var requireRegStr = '((?:[^\\$\\.]|^)\\brequire(?:\\s*\\.\\s*(async|defer))?\\s*\\(\\s*)(' +
      stringRegStr + '|' +
      jsStringArrayRegStr + ')';

    var reg = new RegExp(stringRegStr + '|' +
    jscommentRegStr + '|' +
    requireRegStr, 'g');

    content = tagFilter.filterBlock(content,
      'script',
      smarty_left_delimiter,
      smarty_right_delimiter,
      function (outter, attr, inner) {
        var requires = {
          sync: {},
          async: {}
        };

        inner.replace(reg,
          function (all, requirePrefix, requireType, requireValueStr) {
            var requireValue;
            var holder;

            if (requirePrefix) {

              requireValueStr = requireValueStr.trim().replace(/(^\[|\]$)/g, '');

              requireValue = requireValueStr.split(/\s*,\s*/);

              requireType = 'require' + (requireType ? ('.' + requireType) : '');

              switch (requireType) {
                case 'require':
                  holder = requires.sync;
                  break;
                case 'require.async':
                case 'require.defer':
                  holder = requires.async;
                  break;
                default:
                  break;
              }

              requireValue.forEach(function (item, index, array) {
                holder[item] = true;
              });
            }
          });

        var arr = [];
        for (var i in requires.sync) {
          if (requires.sync.hasOwnProperty(i)) {
            arr.push(i);
          }
        }
        attr += ' sync=[' + arr.join(',') + ']';

        arr = [];
        for (var i in requires.async) {
          if (requires.async.hasOwnProperty(i)) {
            arr.push(i);
          }
        }
        attr += ' async=[' + arr.join(',') + ']';

        return smarty_left_delimiter +
          'script' +
          attr +
          smarty_right_delimiter +
          inner +
          smarty_left_delimiter +
          '/script' +
          smarty_right_delimiter;
      });

    file.contents = new Buffer(content);

    callback(null, file);
  }

  return through.obj(analyse);
};

//The main purpose of the defineWidget is to establish the relationship between files and the corresponding function call by {widget}
module.exports.defineWidget = function (opt) {
  var smarty_left_delimiter = her.config.get('setting.smarty.left_delimiter') || '{';
  var smarty_right_delimiter = her.config.get('setting.smarty.right_delimiter') || '}';

  function define(file, encoding, callback) {

    if (file.isNull()) {
      return callback(null, file);
    }

    if (file.isStream()) {
      return callback(createError(file, 'Streaming not supported'));
    }

    var methodReg = new RegExp('((?:^|\\s)method\\s*=\\s*)(' + stringRegStr + ')');
    var nameReg = new RegExp('(?:^|\\s)name\\s*=\\s*(' + stringRegStr + ')');


    var content = String(file.contents);
    var connector = her.config.get('project.md5Connector', '_');
    //replace the {define} to {function}, name like "_$md5standardpath_$method" ,"$method" default to __main
    content = tagFilter.filterBlock(content,
      'define', smarty_left_delimiter, smarty_right_delimiter,
      function (outter, attr, inner) {
        //standard the path and md5

        var md5Name = connector + her.util.md5(file.id, 32) + connector;
        //判断define中是否有method属性
        if (methodReg.test(attr)) {

          attr = attr.replace(methodReg, function (all, methodPrefix, methodValue) {
            var info = her.util.stringQuote(methodValue);
            return methodPrefix.replace('method', 'name') + info.quote + md5Name + info.rest + info.quote;
          });
        } else {
          attr += ' name=\'' + md5Name + '__main\'';
        }

        return smarty_left_delimiter +
          'function' +
          attr +
          smarty_right_delimiter +
          inner +
          smarty_left_delimiter +
          '/function' +
          smarty_right_delimiter;
      });

    //replace the {widget} method to "_$md5standardpath_$method"
    content = tagFilter.filterTag(content,
      'widget', smarty_left_delimiter, smarty_right_delimiter,
      function (outter, attr, inner) {
        var matches = attr.match(nameReg);
        if (!matches) {
          throw new Error('widget must define name attribute');
        } else {
          var info = her.util.stringQuote(matches[1]);
          var widgetName = connector + her.util.md5(info.rest, 32) + connector;
        }
        if (methodReg.test(attr)) {
          attr = attr.replace(methodReg, function (all, methodPrefix, methodValue) {
            info = her.util.stringQuote(methodValue);

            return methodPrefix + info.quote + widgetName + info.rest + info.quote;
          });
        } else {
          attr += ' method=\'' + widgetName + '__main\'';
        }

        return smarty_left_delimiter +
          'widget' +
          attr +
          smarty_right_delimiter;
      });

    file.contents = new Buffer(content);

    callback(null, file);
  }

  return through.obj(define);
};
