defmodule Cura.Repo.Seeds.Documents do
  @moduledoc """
  Seeds patient documents (clinical PDFs).

  Source PDFs live in `priv/repo/seeds/documents/*.pdf` — they're plain
  test-result reports kept simple on purpose so the AI document-parser has
  predictable text to extract. Each seeded patient gets 0-3 random docs
  uploaded by the doctor they're paired with (doctorN ↔ patientN).
  """

  alias Cura.Accounts.User
  alias Cura.Documents.PatientDocument
  alias Cura.Repo

  import Ecto.Query

  @source_dir Path.join([:code.priv_dir(:cura), "repo", "seeds", "documents"])

  # Map of source filename → human-friendly display name. The display name is
  # what surfaces in the UI; the storage_path stays as a UUID-based slug.
  @display_names %{
    "cbc_mild_anemia.pdf" => "Hemograma completo.pdf",
    "lipid_panel_high_ldl.pdf" => "Perfil lipídico.pdf",
    "hba1c_uncontrolled.pdf" => "Hemoglobina glicada.pdf",
    "tsh_hypothyroid.pdf" => "Função tiroideia.pdf",
    "urinalysis_proteinuria.pdf" => "Análise sumária de urina.pdf",
    "chest_xray_pneumonia.pdf" => "Radiografia do tórax.pdf",
    "ecg_pvcs.pdf" => "Eletrocardiograma.pdf",
    "vitamin_d_deficient.pdf" => "Vitamina D.pdf"
  }

  def run do
    case Repo.aggregate(PatientDocument, :count) do
      0 ->
        seed_documents()

      _ ->
        IO.puts("Patient documents already exist, skipping seeding.")
    end
  end

  def seed_documents do
    sources = list_source_pdfs()

    cond do
      sources == [] ->
        Mix.shell().error(
          "No source PDFs found in #{@source_dir}; cannot seed patient documents."
        )

      true ->
        patients =
          Repo.all(from u in User, where: u.role == :patient)
          |> Enum.sort_by(&seed_index/1)

        doctors =
          Repo.all(from u in User, where: u.role == :doctor)
          |> Enum.sort_by(&seed_index/1)

        cond do
          patients == [] ->
            Mix.shell().error("No patients found; seed users first.")

          doctors == [] ->
            Mix.shell().error("No doctors found; seed users first.")

          true ->
            File.mkdir_p!(uploads_dir())

            inserted =
              patients
              |> Enum.with_index(1)
              |> Enum.flat_map(fn {patient, idx} ->
                # Skew distribution: most patients get 1-2 docs, some get 0 or 3.
                count = Enum.random([0, 1, 1, 2, 2, 2, 3])
                docs = Enum.take_random(sources, count)

                # Pair each patient with their seeded doctor when possible.
                uploader = Enum.at(doctors, idx - 1) || Enum.random(doctors)

                Enum.map(docs, fn source ->
                  insert_document!(patient, uploader, source)
                end)
              end)

            Mix.shell().info(
              "Seeded #{length(inserted)} patient document(s) for #{length(patients)} patient(s)."
            )
        end
    end
  end

  defp list_source_pdfs do
    case File.ls(@source_dir) do
      {:ok, names} ->
        names
        |> Enum.filter(&String.ends_with?(&1, ".pdf"))
        |> Enum.map(&Path.join(@source_dir, &1))
        |> Enum.sort()

      {:error, _} ->
        []
    end
  end

  defp insert_document!(patient, uploader, source_path) do
    source_name = Path.basename(source_path)
    storage_name = "#{Ecto.UUID.generate()}.pdf"
    dest = Path.join(uploads_dir(), storage_name)

    File.copy!(source_path, dest)
    %{size: size} = File.stat!(dest)

    %PatientDocument{}
    |> PatientDocument.changeset(%{
      patient_id: patient.id,
      uploaded_by_id: uploader.id,
      filename: Map.get(@display_names, source_name, source_name),
      content_type: "application/pdf",
      size: size,
      storage_path: storage_name
    })
    |> Repo.insert!()
  end

  defp uploads_dir do
    Cura.Documents.uploads_dir()
  end

  # Sort users by the numeric suffix in their seeded email so doctorN/patientN
  # land at index N-1 regardless of insertion order. Mirrors meetings.exs.
  defp seed_index(%User{email: email}) do
    case Regex.run(~r/(\d+)@/, email) do
      [_, n] -> String.to_integer(n)
      _ -> 0
    end
  end
end

Cura.Repo.Seeds.Documents.run()
