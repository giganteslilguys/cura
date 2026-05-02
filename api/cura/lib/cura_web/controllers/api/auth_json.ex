defmodule CuraWeb.Api.AuthJSON do
  alias Cura.Accounts.{PatientProfile, User}

  def user(%{user: user}), do: %{user: data(user)}

  def user_with_token(%{user: user, token: token}) do
    %{user: data(user), token: token}
  end

  defp data(%User{} = user) do
    %{
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      patient_profile: profile(user.patient_profile)
    }
  end

  defp profile(%PatientProfile{} = profile) do
    %{
      sex: profile.sex,
      date_of_birth: profile.date_of_birth,
      weight_kg: profile.weight_kg,
      height_cm: profile.height_cm,
      bmi: PatientProfile.bmi(profile),
      medications:
        Enum.map(profile.medications, fn m ->
          %{name: m.name, dose: m.dose, frequency: m.frequency}
        end),
      allergies:
        Enum.map(profile.allergies, fn a ->
          %{substance: a.substance, severity: a.severity}
        end),
      conditions: profile.conditions
    }
  end

  defp profile(_), do: nil
end
