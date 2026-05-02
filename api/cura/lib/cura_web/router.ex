defmodule CuraWeb.Router do
  use CuraWeb, :router

  import CuraWeb.UserAuth

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :authenticated_api do
    plug :fetch_api_user
  end

  if Mix.env() == :dev do
    forward "/dev/mailbox", Plug.Swoosh.MailboxPreview
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

    post "/meetings/on_site", MeetingController, :on_site
    get "/meetings", MeetingController, :index
    get "/meetings/:id", MeetingController, :show
    get "/meetings/:id/transcript", MeetingController, :transcript
    patch "/meetings/:id/intake", MeetingController, :intake
    patch "/meetings/:id/notes", MeetingController, :update_notes
    patch "/meetings/:id/soap_note", MeetingController, :soap_note
    post "/meetings/:id/generate_soap", MeetingController, :generate_soap

    get "/doctors", BookingController, :list_doctors
    get "/doctors/:doctor_id/slots", BookingController, :slots
    get "/slots", BookingController, :any_slots
    post "/book", BookingController, :book

    get "/availability", AvailabilityController, :index
    post "/availability", AvailabilityController, :create
    delete "/availability/:id", AvailabilityController, :delete

    get "/patients/:patient_id/documents", DocumentController, :index
    post "/patients/:patient_id/documents", DocumentController, :create
    get "/documents/:id/download", DocumentController, :download
    delete "/documents/:id", DocumentController, :delete
  end
end
