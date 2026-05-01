defmodule Cura.Repo.Seeds.Meetings do
  alias Cura.Accounts.User
  alias Cura.Meetings.Meeting
  alias Cura.Repo

  import Ecto.Query

  @durations [15, 30, 45, 60, 90, 120]
  @titles [
    "Initial Consultation",
    "Follow-up Visit",
    "Wellness Check",
    "Treatment Review",
    "Therapy Session",
    "Progress Update"
  ]
  @notes [
    "Bring previous test results if available.",
    "Patient requested a morning appointment.",
    "Reminder: discuss medication adherence.",
    "Check vitals and update care plan.",
    "Review lab results and next steps.",
    "General follow-up and Q&A."
  ]

  def run do
    case Repo.aggregate(Meeting, :count) do
      0 ->
        seed_meetings()

      _ ->
        IO.puts("Meetings already exist, skipping seeding.")
    end
  end

  def seed_meetings(meetings_per_doctor \\ 6) do
    doctors = Repo.all(from u in User, where: u.role == :doctor)
    patients = Repo.all(from u in User, where: u.role == :patient)

    cond do
      doctors == [] ->
        Mix.shell().error("No doctors found; seed users first.")

      patients == [] ->
        Mix.shell().error("No patients found; seed users first.")

      true ->
        base_date = Date.utc_today()

        doctors
        |> Enum.with_index(1)
        |> Enum.each(fn {doctor, doctor_index} ->
          Enum.each(1..meetings_per_doctor, fn meeting_index ->
            date = Date.add(base_date, doctor_index * 2 + meeting_index)
            time = Time.new!(8 + rem(meeting_index, 8), Enum.random([0, 30]), 0)

            Repo.insert!(%Meeting{
              title: "#{Enum.random(@titles)} - Dr. #{doctor.last_name}",
              date: date,
              time: time,
              duration: Enum.random(@durations),
              notes: Enum.random(@notes),
              timezone: "UTC",
              status: :scheduled,
              doctor_id: doctor.id,
              patient_id: Enum.random(patients).id
            })
          end)
        end)

        Mix.shell().info("Seeded meetings for #{length(doctors)} doctors.")
    end
  end
end

Cura.Repo.Seeds.Meetings.run()
