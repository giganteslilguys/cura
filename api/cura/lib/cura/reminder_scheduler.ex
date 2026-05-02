defmodule Cura.ReminderScheduler do
  use GenServer
  require Logger

  @check_interval :timer.minutes(10)

  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  def init(state) do
    schedule_check()
    {:ok, state}
  end

  def handle_info(:check, state) do
    check_and_send()
    schedule_check()
    {:noreply, state}
  end

  defp schedule_check, do: Process.send_after(self(), :check, @check_interval)

  defp check_and_send do
    now = NaiveDateTime.utc_now()

    Cura.Meetings.find_meetings_due_for_reminder(now)
    |> Enum.each(fn {meeting, hours} ->
      Logger.info("[ReminderScheduler] Sending #{hours}h reminder for meeting #{meeting.id}")
      Cura.Emails.send_reminders(meeting)
      Cura.Meetings.mark_reminder_sent(meeting, hours)
    end)
  end
end
