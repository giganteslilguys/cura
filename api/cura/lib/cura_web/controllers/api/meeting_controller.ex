defmodule CuraWeb.Api.MeetingController do
  use CuraWeb, :controller

  alias Cura.Meetings

  action_fallback CuraWeb.FallbackController

  def index(conn, _params) do
    user = conn.assigns.current_user
    meetings = Meetings.list_meetings_for_user(user.id)
    render(conn, :index, meetings: meetings)
  end

  def show(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    with {:ok, meeting} <- Meetings.get_meeting!(id),
         true <- meeting.doctor_id == user.id or meeting.patient_id == user.id do
      render(conn, :show, meeting: meeting)
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end
end
