// Helper function.
function convertEscapedCodesToCodes(str, prefix, base, num_bits) {
  var parts = str.split(prefix);
  parts.shift();  // Trim the first element.
  var codes = [];
  var max = Math.pow(2, num_bits);
  for (var i = 0; i < parts.length; ++i) {
    var code = parseInt(parts[i], base);
    if (code >= 0 && code < max) {
      codes.push(code);
    } else {
      // Malformed code ignored.
    }
  }
  return codes;
}

// r'\u3042\u3044' => [ 0x3042, 0x3044 ]
// Note that the r '...' notation is borrowed from Python.
function convertEscapedUtf16CodesToUtf16Codes(str) {
  return convertEscapedCodesToCodes(str, "\\u", 16, 16);
}
      
// [ 0x3042, 0x3044 ] => "ã‚ã„"
function convertUtf16CodesToString(utf16_codes) {
  var unescaped = '';
  for (var i = 0; i < utf16_codes.length; ++i) {
    unescaped += String.fromCharCode(utf16_codes[i]);
  }
  return unescaped;
}

// r'\u3042\u3044 => "ã‚ã„"
function unescapeFromUtf16(str) {
  var utf16_codes = convertEscapedUtf16CodesToUtf16Codes(str);
  return convertUtf16CodesToString(utf16_codes);
}
      
$(".email").click(function(event) {
  event.preventDefault();
  window.location.href = "mailto:" + unescapeFromUtf16($(this).data("val").replace("\\u3434", "\\u0040"));
});
