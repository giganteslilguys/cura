defmodule Cura.Accounts.PatientProfile do
  use Cura.Schema
  alias Cura.Accounts.User

  defmodule Medication do
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key false
    embedded_schema do
      field :name, :string
      field :dose, :string
      field :frequency, :string
    end

    def changeset(medication, attrs) do
      medication
      |> cast(attrs, [:name, :dose, :frequency])
      |> validate_required([:name])
    end
  end

  defmodule Allergy do
    use Ecto.Schema
    import Ecto.Changeset

    @severities [:mild, :moderate, :severe]

    @primary_key false
    embedded_schema do
      field :substance, :string
      field :severity, Ecto.Enum, values: @severities
    end

    def changeset(allergy, attrs) do
      allergy
      |> cast(attrs, [:substance, :severity])
      |> validate_required([:substance, :severity])
    end
  end

  @sexes [:male, :female, :other]

  schema "patient_profiles" do
    belongs_to :user, User

    field :sex, Ecto.Enum, values: @sexes
    field :date_of_birth, :date
    field :weight_kg, :float
    field :height_cm, :float

    embeds_many :medications, Medication, on_replace: :delete
    embeds_many :allergies, Allergy, on_replace: :delete
    field :conditions, {:array, :string}, default: []

    timestamps()
  end

  def changeset(profile, attrs) do
    profile
    |> cast(attrs, [:user_id, :sex, :date_of_birth, :weight_kg, :height_cm, :conditions])
    |> cast_embed(:medications, with: &Medication.changeset/2)
    |> cast_embed(:allergies, with: &Allergy.changeset/2)
    |> validate_required([:user_id])
    |> validate_number(:weight_kg, greater_than: 0, less_than: 1000)
    |> validate_number(:height_cm, greater_than: 0, less_than: 300)
    |> unique_constraint(:user_id)
  end

  @doc """
  BMI derived from height and weight. Returns nil when either is missing —
  callers should treat nil as "not enough data" rather than zero.
  """
  def bmi(%__MODULE__{weight_kg: w, height_cm: h}) when is_number(w) and is_number(h) and h > 0 do
    height_m = h / 100
    Float.round(w / (height_m * height_m), 1)
  end

  def bmi(_), do: nil
end
