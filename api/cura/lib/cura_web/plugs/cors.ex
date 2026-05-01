defmodule CuraWeb.Plugs.CORS do
  @moduledoc """
  Minimal CORS plug for the JSON API. Allows the configured origins to
  call the API and short-circuits OPTIONS preflight requests.
  """

  @behaviour Plug
  import Plug.Conn

  @default_origins ["http://localhost:3000"]
  @allowed_methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  @allowed_headers "Authorization, Content-Type, Accept, Origin, X-Requested-With"

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    origin =
      case get_req_header(conn, "origin") do
        [o | _] -> o
        _ -> nil
      end

    allowed = Application.get_env(:cura, :cors_origins, @default_origins)

    conn =
      if origin && origin in allowed do
        conn
        |> put_resp_header("access-control-allow-origin", origin)
        |> put_resp_header("access-control-allow-credentials", "true")
        |> put_resp_header("vary", "Origin")
        |> put_resp_header("access-control-allow-methods", @allowed_methods)
        |> put_resp_header("access-control-allow-headers", @allowed_headers)
      else
        conn
      end

    if conn.method == "OPTIONS" do
      conn
      |> send_resp(:no_content, "")
      |> halt()
    else
      conn
    end
  end
end
