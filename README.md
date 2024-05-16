# Burp Log to TS lib
This is a simple project that builds a TypeScript library from a Burp Suite log file, built to interact with whatever service you MitM'd.

To use it you should have a burplog.xml file in the root of the project, and run the following command:
```sh
bun src/index.ts $HOSTNAME_OF_SERVICE
```
Do whatever you want with the output, redirect it to a file if you want to save it.

The library won't be the prettiest, but it its an okay starting point for further development.

Happy hacking!
