import Config

# Configure your database
config :cura, Cura.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "cura_dev",
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :cura, CuraWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "1QxPEPRNhUcUnqfxS8qShXMRV0tZNpLcCaK5VuwcZVJikgXRvOMNyjrJemY690Mr"

# Origins allowed to call the JSON API in dev (Next.js runs on :3000).
config :cura, :cors_origins, [
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]

# Do not include metadata nor timestamps in development logs
config :logger, :default_formatter, format: "[$level] $message\n"

config :phoenix, :stacktrace_depth, 20
config :phoenix, :plug_init_mode, :runtime

# Disable swoosh api client as it is only required for production adapters.
config :swoosh, :api_client, false
