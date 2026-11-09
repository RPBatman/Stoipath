# Local TLS pair for the benchmark server

The self-signed localhost key and certificate this benchmark used (expired 27-28 Oct 2026) were removed from the repository on 2026-11-01 so the secret scan stays clean. Generate a fresh pair in this folder before re-running:

```
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 7 -subj /CN=localhost -keyout key.pem -out cert.pem
```

Do not commit the generated files.
