defmodule CuraWeb.Router do
  use CuraWeb, :router

  import CuraWeb.UserAuth
  import Phoenix.LiveView.Router

  pipeline :api do
    plug :accepts, ["html", "json"]
  end


  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {CuraWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
    plug :fetch_current_user
  end

  pipeline :authenticated_api do
    plug :fetch_api_user
  end

  scope "/api", CuraWeb.Api do
    pipe_through :api

    post "/auth/sign_up", AuthController, :sign_up
    post "/auth/sign_in", AuthController, :sign_in
  end

  scope "/", CuraWeb do
    pipe_through :browser

    get "/login", SessionController, :new
    post "/login", SessionController, :create
    delete "/logout", SessionController, :delete

    live_session :require_authenticated_user,
      on_mount: [{CuraWeb.UserAuth, :require_authenticated_user}] do
      live "/meetings", MeetingsLive.Index, :redirect_to_default
      live "/meetings/:id", MeetingsLive.Index
    end
  end

  scope "/api", CuraWeb.Api do
    pipe_through [:api, :authenticated_api]

    delete "/auth/sign_out", AuthController, :sign_out
    get "/me", AuthController, :me
  end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:cura, :dev_routes) do
    pipeline :browser do
      plug :accepts, ["html"]
      plug :fetch_session
      plug :protect_from_forgery
      plug :put_secure_browser_headers
    end

    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: CuraWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
