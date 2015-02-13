/**
 * Created by HuangYi on 15/1/20.
 */

/**
 * get position of the code via index
 *
 * @param source {String} code
 * @param index {Number} index
 * @access public
 * @return {Object}
 */
function getPosition(source, index) {
  var line;
  var ichar;
  var start = 0;
  var next = 0;

  if (index < source.length) {
    line = 1;
    do {
      next = source.indexOf("\n", start);
      if (next < 0 || next >= index) {
        ichar = index - start + 1;
        break;
      } else {
        line++;
        start = next + 1;
      }
    } while (true);
  }

  return {
    "line": line,
    "char": ichar
  };
}

/**
 * filter the tag from file
 *
 * @param content {String} file content
 * @param name {String} block name
 * @param ld {String} left delimiter
 * @param rd {String} right delimiter
 * @param callback {Function} filter function
 * @param isBlock {Boolean} whether is a block tag
 * @access public
 * @return {String} the processed file
 */
function filter(content, name, ld, rd, callback, isBlock) {

  if (!callback) {
    return content;
  }

  isBlock = !!isBlock;

  var openTag = ld + name;
  var openTagLen = openTag.length;
  var closeTag = ld + "/" + name + rd;
  var closeTagLen = closeTag.length;
  var ldLen = ld.length;
  var rdLen = rd.length;

  var outterStart = 0;
  var attrStart = 0;
  var attrEnd = 0;
  var innerStart = 0;
  var innerEnd = 0;
  var outterEnd = 0;

  var index = 0;
  var lastIndex = 0;
  var output = [];

  //start to find the openTag
  while ((index = content.indexOf(openTag, index)) > -1) {
    outterStart = index;
    attrStart = outterStart + openTagLen;
    //check whether attr is exsist
    if (content.substring(attrStart, attrStart + rdLen) === rd) {
      //eg: <script>
      attrEnd = attrStart;
    } else if (/\s/.test(content[attrStart])) {
      //eg: <script src="xxx"> or <script >
      index = attrStart;
      attrEnd = attrStart;
      do {
        //solve nested situation eg {script xxx={$xxx}}
        attrEnd = content.indexOf(rd, attrEnd);
        index = content.indexOf(ld, index);

        if (attrEnd < 0) {
          //tag not closed
          //eg： {script src="xxx" $EOF$
        }
        else if (index > -1 && index < attrEnd) {
          //is nested tag
          // {script xxx={$xxx}}
          //             ^    ^
          //          index attrEnd
          index++;
          attrEnd++;
          continue;
        } else {
          // find the matched tag
          // {script xxx={$xxx}}  ...  var a = {} ...
          //                   ^               ^
          //                 attrEnd         index
          break;
        }

      }
      while (false);
    }
    else {
      //tag is not matched
      //eg: <scriptXX>
      index = outterStart + openTagLen;
      continue;
    }

    output.push(content.substring(lastIndex, outterStart));

    if (isBlock) {
      innerStart = attrEnd + rdLen;

      innerEnd = content.indexOf(closeTag, innerStart);
      if (innerEnd < 0) {
        //can't find the closeTag
        //eg {script src="xxx"}  $EOF$
        var position = getPosition(content, outterStart);
        throw new Error("Unclosed block \"" + content.substring(outterStart, outterStart + 20) + "...\" opend on line:" + position.line + " char:" + position.char);
      }
      outterEnd = innerEnd + closeTagLen;

      output.push(callback(
        content.substring(outterStart, outterEnd),
        content.substring(attrStart, attrEnd),
        content.substring(innerStart, innerEnd),
        content
      ));

    } else {
      outterEnd = attrEnd + rdLen;
      output.push(callback(
        content.substring(outterStart, outterEnd),
        content.substring(attrStart, attrEnd),
        content
      ));
    }

    index = outterEnd;
    lastIndex = index;

  }

  output.push(content.substring(lastIndex));

  return output.join('');

}

module.exports = {
  filterTag: function (content, name, ld, rd, callback) {
    return filter(content, name, ld, rd, callback, false);
  },
  filterBlock: function (content, name, ld, rd, callback) {
    return filter(content, name, ld, rd, callback, true);
  }
};

