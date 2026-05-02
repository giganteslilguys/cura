defmodule Cura.Repo.Seeds.Accounts do
  alias Cura.Accounts

  @first_names File.read!("priv/fake/first_names.txt") |> String.split("\n", trim: true)
  @last_names File.read!("priv/fake/last_names.txt") |> String.split("\n", trim: true)

  @sexes [:male, :female, :other]

  @medications [
    %{name: "Lisinopril", dose: "10mg", frequency: "diariamente"},
    %{name: "Metformin", dose: "500mg", frequency: "duas vezes ao dia"},
    %{name: "Atorvastatin", dose: "20mg", frequency: "à noite"},
    %{name: "Levothyroxine", dose: "50mcg", frequency: "antes do café da manhã"},
    %{name: "Amlodipine", dose: "5mg", frequency: "diariamente"},
    %{name: "Omeprazole", dose: "20mg", frequency: "diariamente"},
    %{name: "Salbutamol", dose: "100mcg", frequency: "conforme necessário"},
    %{name: "Sertraline", dose: "50mg", frequency: "diariamente"},
    %{name: "Ibuprofen", dose: "400mg", frequency: "conforme necessário"},
    %{name: "Warfarin", dose: "5mg", frequency: "diariamente"}
  ]

  @allergies [
    %{substance: "Penicillin", severity: :moderate},
    %{substance: "Peanuts", severity: :severe},
    %{substance: "Latex", severity: :mild},
    %{substance: "Shellfish", severity: :severe},
    %{substance: "Aspirin", severity: :moderate},
    %{substance: "Sulfa drugs", severity: :moderate},
    %{substance: "Pollen", severity: :mild},
    %{substance: "Dust mites", severity: :mild},
    %{substance: "Iodine", severity: :severe}
  ]

  @conditions [
    "Hipertensão",
    "Diabetes Tipo 2",
    "Asma",
    "Hipotireoidismo",
    "Hyperlipidemia",
    "Osteoporose",
    "Ansiedade",
    "Depressao",
    "Enxaqueca",
    "COPD"
  ]

  def run do
    case Cura.Repo.aggregate(Cura.Accounts.User, :count) do
      0 ->
        seed_users()

      _ ->
        IO.puts("Users already exist, skipping seeding.")
    end
  end

  def seed_users(doctors \\ 15, patients \\ 50) do
    seed_role(:doctor, doctors)
    seed_role(:patient, patients)
  end

  defp seed_role(role, count) do
    for i <- 1..count do
      first_name = Enum.random(@first_names)
      last_name = @last_names |> Enum.take_random(2) |> Enum.join(" ")
      email = "#{role}#{i}@cura.pt"

      attrs = %{
        first_name: first_name,
        last_name: last_name,
        email: email,
        password: "password1234",
        role: role
      }

      case Accounts.register_user(attrs) do
        {:ok, user} ->
          if role == :patient, do: seed_patient_profile(user)
          Mix.shell().info("Created #{role} #{user.first_name} #{user.last_name} (#{email})")

        {:error, changeset} ->
          Mix.shell().error(
            "Error creating #{role} #{i}: " <> Kernel.inspect(changeset.errors)
          )
      end
    end
  end

  defp seed_patient_profile(user) do
    height_cm = Enum.random(150..195) * 1.0
    # weight loosely correlated with height so BMI lands in a believable range
    weight_kg = Float.round((height_cm - 100) + Enum.random(-15..25) * 1.0, 1)

    attrs = %{
      user_id: user.id,
      sex: Enum.random(@sexes),
      date_of_birth: random_dob(),
      height_cm: height_cm,
      weight_kg: weight_kg,
      medications: Enum.take_random(@medications, Enum.random(0..3)),
      allergies: Enum.take_random(@allergies, Enum.random(0..2)),
      conditions: Enum.take_random(@conditions, Enum.random(0..3))
    }

    case Accounts.create_patient_profile(attrs) do
      {:ok, _profile} ->
        :ok

      {:error, changeset} ->
        Mix.shell().error(
          "Error creating profile for #{user.email}: " <> Kernel.inspect(changeset.errors)
        )
    end
  end

  defp random_dob do
    today = Date.utc_today()
    age_years = Enum.random(18..85)
    day_offset = Enum.random(0..364)
    Date.add(today, -(age_years * 365 + day_offset))
  end
end

Cura.Repo.Seeds.Accounts.run()
