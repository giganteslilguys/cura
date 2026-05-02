defmodule CuraWeb.Api.BookingController do
  use CuraWeb, :controller

  alias Cura.Accounts
  alias Cura.Meetings

  action_fallback CuraWeb.FallbackController

  def list_doctors(conn, _params) do
    doctors = Accounts.list_doctors()
    render(conn, :doctors, doctors: doctors)
  end

  def slots(conn, %{"doctor_id" => doctor_id, "date" => date_str}) do
    with {:ok, date} <- Date.from_iso8601(date_str) do
      slots = Meetings.get_available_slots(doctor_id, date)
      render(conn, :slots, slots: slots)
    else
      {:error, _} -> {:error, :bad_request}
    end
  end

  def any_slots(conn, %{"date" => date_str}) do
    with {:ok, date} <- Date.from_iso8601(date_str) do
      slots = Meetings.get_any_available_slots(date)
      render(conn, :any_slots, slots: slots)
    else
      {:error, _} -> {:error, :bad_request}
    end
  end

  def book(conn, params) do
    user = conn.assigns.current_user

    with true <- user.role == :patient,
         {:ok, meeting} <- Meetings.book_slot(user.id, params) do
      Cura.Emails.send_booking_confirmations(meeting)

      conn
      |> put_status(:created)
      |> render(:meeting, meeting: meeting)
    else
      false ->
        {:error, :unauthorized}

      {:error, :slot_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "This slot is no longer available."})

      error ->
        error
    end
  end
end
