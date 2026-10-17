## Wallet Security Notes

* Production systems must disable core dumps before handling generated Stellar secrets.
* Use `ulimit -c 0` or the platform equivalent to prevent crash dumps from capturing wallet material. Any limit other than `0-- including `unlimited` -- allows a core image that could contain decrypted user secrets, and the application will warn at startup.
* Avoid logging `secret` values, even in debug builds.
