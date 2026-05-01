import Config

config :cura,
  ecto_repos: [Cura.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

config :cura, CuraWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: CuraWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Cura.PubSub

config :cura, Cura.Mailer, adapter: Swoosh.Adapters.Local

config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
