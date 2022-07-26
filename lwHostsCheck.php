<html>
<body>
<?
echo "<h2>Server info</h2>";

$baseurl=$_SERVER['SERVER_NAME'];

echo "You're accessing: " . $baseurl . "<br>"; //or $_SERVER['HTTP_HOST'] . "<br>"; //or $_SERVER['SERVER_NAME']

echo "This server's Ip: " . $_SERVER['SERVER_ADDR'] . "<br>";

echo "This server's hostname: ";
if (function_exists('gethostname')) {
  echo gethostname() ;
} else {
  //for php < 5.3
  echo php_uname('n');
}
echo "<br><br>";

//get baseurl to direct customer to testing info
echo "Test this domain here: <a href=http://" . $baseurl . ">" . $baseurl . "</a>";

?>
</body>
</html>

