defmodule CuraWeb.Router do
  use CuraWeb, :router

  import CuraWeb.UserAuth

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :authenticated_api do
    plug :fetch_api_user
  end

  scope "/api", CuraWeb.Api do
    pipe_through :api

    post "/auth/sign_up", AuthController, :sign_up
    post "/auth/sign_in", AuthController, :sign_in
  end

  scope "/api", CuraWeb.Api do
    pipe_through [:api, :authenticated_api]

    delete "/auth/sign_out", AuthController, :sign_out
    get "/me", AuthController, :me

    get "/meetings", MeetingController, :index
    get "/meetings/:id", MeetingController, :show
    patch "/meetings/:id/intake", MeetingController, :intake
  end
end
