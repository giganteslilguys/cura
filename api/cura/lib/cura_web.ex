defmodule CuraWeb do
  @moduledoc """
  Entrypoint for the JSON API web layer. The frontend lives in
  `clients/web/cura` (Next.js); this app only serves JSON over HTTP and
  WebRTC signalling over the Phoenix Socket.
  """

  def static_paths, do: ~w()

  def router do
    quote do
      use Phoenix.Router, helpers: false

      import Plug.Conn
      import Phoenix.Controller
    end
  end

  def channel do
    quote do
      use Phoenix.Channel
    end
  end

  def controller do
    quote do
      use Phoenix.Controller, formats: [:json]

      import Plug.Conn

      unquote(verified_routes())
    end
  end

  def verified_routes do
    quote do
      use Phoenix.VerifiedRoutes,
        endpoint: CuraWeb.Endpoint,
        router: CuraWeb.Router,
        statics: CuraWeb.static_paths()
    end
  end

  defmacro __using__(which) when is_atom(which) do
    apply(__MODULE__, which, [])
  end
end
