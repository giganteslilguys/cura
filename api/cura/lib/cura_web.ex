defmodule CuraWeb do
  @moduledoc """
  The entrypoint for defining the JSON API web interface.

      use CuraWeb, :controller
      use CuraWeb, :router
  """

  def static_paths, do: ~w(assets fonts images favicon.ico robots.txt)

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

  def browser_controller do
    quote do
      use Phoenix.Controller, formats: [:html, :json]

      import Plug.Conn
      import Phoenix.HTML

      unquote(verified_routes())
    end
  end


  def live_view do
    quote do
      use Phoenix.LiveView,
        layout: {CuraWeb.Layouts, :root}

      unquote(html_helpers())
    end
  end

  def html do
    quote do
      use Phoenix.Component

      # Import convenience functions from controllers
      import Phoenix.Controller,
        only: [get_csrf_token: 0, view_module: 1, view_template: 1]

      # Include general helpers for rendering HTML
      # unquote(html_helpers())
    end
  end

  defp html_helpers do
    quote do
      # Translation
      # use Gettext, backend: CuraWeb.Gettext

      # HTML escaping functionality
      import Phoenix.HTML

      # Shortcut for generating JS commands
      alias Phoenix.LiveView.JS
      # import CuraWeb.Helpers

      # Routes generation with the ~p sigil
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
