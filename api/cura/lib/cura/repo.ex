defmodule Cura.Repo do
  use Ecto.Repo,
    otp_app: :cura,
    adapter: Ecto.Adapters.Postgres
end
